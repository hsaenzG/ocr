import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  type QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import {
  SURVEY_FILTER_KEYS,
  SURVEY_KAP_FIELDS,
  canonicalizeSurveyAnswer,
  canonicalizeSurveyFieldKey,
  foldText,
  mergeAnswerCounts,
} from "@ocr/shared";
import type {
  AnalyticsDocumentsResult,
  AnalyticsSummary,
  DocumentAnalyticsRecord,
  DocumentDetail,
  DocumentListQuery,
  DocumentListResult,
  DocumentMetaRecord,
  DocumentRepository,
  DocumentStatus,
  StatsSummary,
} from "../ports.js";

type DynamoItem = Record<string, unknown>;

const FILTERABLE_FIELDS = SURVEY_KAP_FIELDS.filter((field) =>
  (SURVEY_FILTER_KEYS as readonly string[]).includes(field.key),
).map((field) => ({ key: field.key, label: field.label }));

export function createDocumentRepository(deps: {
  tableName: string;
  client?: DynamoDBDocumentClient;
}): DocumentRepository {
  const doc =
    deps.client ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  const tableName = deps.tableName;

  return {
    async putUploadedDocument(meta: DocumentMetaRecord): Promise<void> {
      const ttl =
        meta.expiresAt ??
        Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24h orphan cleanup

      const metaItem = {
        PK: `DOC#${meta.documentId}`,
        SK: "META",
        entityType: "DOCUMENT",
        ...meta,
        expiresAt: ttl,
      };
      const docsItem = {
        PK: "DOCS",
        SK: `TS#${meta.createdAt}#DOC#${meta.documentId}`,
        entityType: "STATUS_ITEM",
        documentId: meta.documentId,
        filename: meta.filename,
        status: meta.status,
        contentType: meta.contentType,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        expiresAt: ttl,
      };
      const statusItem = {
        PK: `STATUS#${meta.status}`,
        SK: `TS#${meta.createdAt}#DOC#${meta.documentId}`,
        entityType: "STATUS_ITEM",
        documentId: meta.documentId,
        filename: meta.filename,
        status: meta.status,
        contentType: meta.contentType,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        expiresAt: ttl,
      };

      await Promise.all([
        doc.send(new PutCommand({ TableName: tableName, Item: metaItem })),
        doc.send(new PutCommand({ TableName: tableName, Item: docsItem })),
        doc.send(new PutCommand({ TableName: tableName, Item: statusItem })),
      ]);

      const date = meta.createdAt.slice(0, 10);
      await doc.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: "STATS#DAILY", SK: `DATE#${date}` },
          UpdateExpression:
            "SET #date = if_not_exists(#date, :date), entityType = if_not_exists(entityType, :entityType), updatedAt = :updatedAt ADD uploaded :one",
          ExpressionAttributeNames: { "#date": "date" },
          ExpressionAttributeValues: {
            ":date": date,
            ":entityType": "DAILY_STATS",
            ":updatedAt": meta.createdAt,
            ":one": 1,
          },
        }),
      );
    },

    async listDocuments(query: DocumentListQuery): Promise<DocumentListResult> {
      const pk = query.status ? `STATUS#${query.status}` : "DOCS";
      const exclusiveStartKey = decodeCursor(query.cursor);

      const result: QueryCommandOutput = await doc.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": pk },
          ScanIndexForward: false,
          Limit: query.limit,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      const items = (result.Items ?? []).map((item) => ({
        documentId: String(item.documentId),
        filename: String(item.filename),
        status: item.status as DocumentStatus,
        contentType: String(item.contentType),
        createdAt: String(item.createdAt),
        updatedAt: String(item.updatedAt),
      }));

      return {
        items,
        nextCursor: encodeCursor(result.LastEvaluatedKey as DynamoItem | undefined),
      };
    },

    async getDocumentDetail(documentId: string): Promise<DocumentDetail | null> {
      const result = await doc.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": `DOC#${documentId}` },
        }),
      );

      const items = result.Items ?? [];
      if (items.length === 0) {
        return null;
      }

      const metaItem = items.find((item) => item.SK === "META");
      if (!metaItem) {
        return null;
      }

      const extractItem = items.find((item) => item.SK === "EXTRACT");
      const analyticsItem = items.find((item) => item.SK === "ANALYTICS");
      const jobItems = items.filter(
        (item) => typeof item.SK === "string" && item.SK.startsWith("JOB#"),
      );

      return {
        meta: {
          documentId: String(metaItem.documentId),
          filename: String(metaItem.filename),
          contentType: String(metaItem.contentType),
          sizeBytes: Number(metaItem.sizeBytes),
          s3Bucket: String(metaItem.s3Bucket),
          s3Key: String(metaItem.s3Key),
          status: metaItem.status as DocumentStatus,
          createdAt: String(metaItem.createdAt),
          updatedAt: String(metaItem.updatedAt),
          completedAt: metaItem.completedAt
            ? String(metaItem.completedAt)
            : undefined,
          errorMessage:
            metaItem.errorMessage === undefined
              ? null
              : (metaItem.errorMessage as string | null),
        },
        extract: extractItem
          ? {
              documentId: String(extractItem.documentId),
              engine: String(extractItem.engine),
              mode: String(extractItem.mode),
              plainText: String(extractItem.plainText),
              lineCount: Number(extractItem.lineCount),
              avgConfidence: Number(extractItem.avgConfidence),
              createdAt: String(extractItem.createdAt),
            }
          : undefined,
        analytics: analyticsItem
          ? {
              documentId: String(analyticsItem.documentId),
              documentKind: String(analyticsItem.documentKind),
              filename: analyticsItem.filename
                ? String(analyticsItem.filename)
                : undefined,
              contentType: analyticsItem.contentType
                ? String(analyticsItem.contentType)
                : undefined,
              parser: analyticsItem.parser
                ? String(analyticsItem.parser)
                : undefined,
              fields: Array.isArray(analyticsItem.fields)
                ? (analyticsItem.fields as Array<{
                    key: string;
                    label: string;
                    value: string;
                    source: string;
                  }>)
                : [],
              metrics: {
                lineCount: Number(
                  (analyticsItem.metrics as { lineCount?: number })?.lineCount ??
                    0,
                ),
                wordCount: Number(
                  (analyticsItem.metrics as { wordCount?: number })?.wordCount ??
                    0,
                ),
                charCount: Number(
                  (analyticsItem.metrics as { charCount?: number })?.charCount ??
                    0,
                ),
                avgConfidence: Number(
                  (analyticsItem.metrics as { avgConfidence?: number })
                    ?.avgConfidence ?? 0,
                ),
                fieldCount: Number(
                  (analyticsItem.metrics as { fieldCount?: number })
                    ?.fieldCount ?? 0,
                ),
              },
              tableRows: Array.isArray(analyticsItem.tableRows)
                ? (analyticsItem.tableRows as Array<{
                    key: string;
                    value: string;
                  }>)
                : [],
              createdAt: String(analyticsItem.createdAt),
            }
          : undefined,
        jobs: jobItems.map((job) => ({
          jobId: String(job.jobId),
          documentId: String(job.documentId),
          status: job.status as DocumentStatus,
          attempt: Number(job.attempt),
          startedAt: job.startedAt ? String(job.startedAt) : undefined,
          endedAt: job.endedAt ? String(job.endedAt) : undefined,
          durationMs:
            job.durationMs === undefined ? undefined : Number(job.durationMs),
          errorCode:
            job.errorCode === undefined
              ? null
              : (job.errorCode as string | null),
          errorMessage:
            job.errorMessage === undefined
              ? null
              : (job.errorMessage as string | null),
        })),
      };
    },

    async updateAnalyticsFields(
      documentId: string,
      fields: Array<{
        key: string;
        label: string;
        value: string;
        source: string;
      }>,
    ): Promise<DocumentAnalyticsRecord | null> {
      const existing = await doc.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: `DOC#${documentId}`, SK: "ANALYTICS" },
        }),
      );
      if (!existing.Item) {
        return null;
      }

      const previousFields = Array.isArray(existing.Item.fields)
        ? (existing.Item.fields as Array<{
            key?: string;
            label?: string;
            value?: string;
          }>)
        : [];

      for (const field of previousFields) {
        if (!field.key || !field.value) continue;
        const fieldKey = canonicalizeSurveyFieldKey(
          field.key,
          field.label ?? "",
        );
        const valueKey = sanitizeSortValue(
          canonicalizeSurveyAnswer(String(field.value), fieldKey),
        );
        await doc.send(
          new DeleteCommand({
            TableName: tableName,
            Key: {
              PK: `FIELD#${fieldKey}`,
              SK: `VALUE#${valueKey}#DOC#${documentId}`,
            },
          }),
        );
        // Best-effort cleanup of pre-normalization keys/values.
        await doc.send(
          new DeleteCommand({
            TableName: tableName,
            Key: {
              PK: `FIELD#${field.key}`,
              SK: `VALUE#${sanitizeSortValue(String(field.value))}#DOC#${documentId}`,
            },
          }),
        );
      }

      const now = new Date().toISOString();
      const metrics = {
        lineCount: Number(
          (existing.Item.metrics as { lineCount?: number })?.lineCount ?? 0,
        ),
        wordCount: Number(
          (existing.Item.metrics as { wordCount?: number })?.wordCount ?? 0,
        ),
        charCount: Number(
          (existing.Item.metrics as { charCount?: number })?.charCount ?? 0,
        ),
        avgConfidence: Number(
          (existing.Item.metrics as { avgConfidence?: number })
            ?.avgConfidence ?? 0,
        ),
        fieldCount: fields.length,
      };

      const tableRows = fields.map((field) => ({
        key: field.label,
        value: field.value,
      }));

      const analyticsItem = {
        ...existing.Item,
        fields,
        tableRows,
        metrics,
        updatedAt: now,
        correctedAt: now,
      };

      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: analyticsItem,
        }),
      );

      for (const field of fields) {
        await doc.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              PK: `FIELD#${field.key}`,
              SK: `VALUE#${sanitizeSortValue(field.value)}#DOC#${documentId}`,
              entityType: "ANALYTICS_FIELD_ITEM",
              documentId,
              fieldKey: field.key,
              fieldLabel: field.label,
              fieldValue: field.value,
              createdAt: String(existing.Item.createdAt ?? now),
              updatedAt: now,
            },
          }),
        );
      }

      return {
        documentId,
        documentKind: String(existing.Item.documentKind ?? "generic"),
        filename: existing.Item.filename
          ? String(existing.Item.filename)
          : undefined,
        contentType: existing.Item.contentType
          ? String(existing.Item.contentType)
          : undefined,
        parser: existing.Item.parser
          ? String(existing.Item.parser)
          : undefined,
        fields: fields.map((field) => ({
          key: field.key,
          label: field.label,
          value: field.value,
          source: field.source,
        })),
        metrics,
        tableRows,
        createdAt: String(existing.Item.createdAt ?? now),
      };
    },

    async getStatsSummary(
      fromDate: string,
      toDate: string,
    ): Promise<StatsSummary> {
      const result = await doc.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
          ExpressionAttributeValues: {
            ":pk": "STATS#DAILY",
            ":from": `DATE#${fromDate}`,
            ":to": `DATE#${toDate}`,
          },
        }),
      );

      const series = (result.Items ?? []).map((item) => ({
        date: String(item.date),
        uploaded: Number(item.uploaded ?? 0),
        completed: Number(item.completed ?? 0),
        failed: Number(item.failed ?? 0),
        processing: Number(item.processing ?? 0),
      }));

      const totals = series.reduce(
        (acc, day) => ({
          uploaded: acc.uploaded + day.uploaded,
          completed: acc.completed + day.completed,
          failed: acc.failed + day.failed,
          processing: acc.processing + day.processing,
        }),
        { uploaded: 0, completed: 0, failed: 0, processing: 0 },
      );

      return { totals, series };
    },

    async getAnalyticsSummary(
      fromDate: string,
      toDate: string,
    ): Promise<AnalyticsSummary> {
      const daily = await doc.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
          ExpressionAttributeValues: {
            ":pk": "STATS#ANALYTICS#DAILY",
            ":from": `DATE#${fromDate}`,
            ":to": `DATE#${toDate}`,
          },
        }),
      );

      const series = (daily.Items ?? []).map((item) => {
        const documentsAnalyzed = Number(item.documentsAnalyzed ?? 0);
        const confidenceSum = Number(item.confidenceSum ?? 0);
        return {
          date: String(item.date),
          documentsAnalyzed,
          avgConfidence:
            documentsAnalyzed === 0
              ? 0
              : Number((confidenceSum / documentsAnalyzed).toFixed(2)),
          totalLines: Number(item.totalLines ?? 0),
          totalWords: Number(item.totalWords ?? 0),
          byContentType: {
            "application/pdf": Number(item.contentTypePdf ?? 0),
            "image/png": Number(item.contentTypePng ?? 0),
            "image/jpeg": Number(item.contentTypeJpeg ?? 0),
            other: Number(item.contentTypeOther ?? 0),
          },
          byKind: {
            survey_kap: Number(item.kind_survey_kap ?? 0),
            invoice: Number(item.kind_invoice ?? 0),
            receipt: Number(item.kind_receipt ?? 0),
            generic: Number(item.kind_generic ?? 0),
          },
        };
      });

      const totalsAcc = series.reduce(
        (acc, day) => ({
          documentsAnalyzed: acc.documentsAnalyzed + day.documentsAnalyzed,
          totalLines: acc.totalLines + day.totalLines,
          totalWords: acc.totalWords + day.totalWords,
          confidenceWeighted:
            acc.confidenceWeighted + day.avgConfidence * day.documentsAnalyzed,
        }),
        {
          documentsAnalyzed: 0,
          totalLines: 0,
          totalWords: 0,
          confidenceWeighted: 0,
        },
      );

      const kindTotals = new Map<string, number>();
      for (const day of series) {
        for (const [kind, count] of Object.entries(day.byKind)) {
          if (count > 0) {
            kindTotals.set(kind, (kindTotals.get(kind) ?? 0) + count);
          }
        }
      }

      const fields = [];
      for (const field of SURVEY_KAP_FIELDS) {
        const result = await doc.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": `FIELD#${field.key}` },
            Limit: 500,
          }),
        );
        const rawValues: string[] = [];
        for (const item of result.Items ?? []) {
          const value = String(item.fieldValue ?? "");
          if (!value) continue;
          rawValues.push(value);
        }
        if (rawValues.length === 0) continue;
        fields.push({
          key: field.key,
          label: field.label,
          values: mergeAnswerCounts(rawValues, field.key).slice(0, 30),
        });
      }

      return {
        totals: {
          documentsAnalyzed: totalsAcc.documentsAnalyzed,
          avgConfidence:
            totalsAcc.documentsAnalyzed === 0
              ? 0
              : Number(
                  (
                    totalsAcc.confidenceWeighted /
                    totalsAcc.documentsAnalyzed
                  ).toFixed(2),
                ),
          totalLines: totalsAcc.totalLines,
          totalWords: totalsAcc.totalWords,
        },
        series,
        fields,
        kinds: [...kindTotals.entries()]
          .map(([kind, count]) => ({ kind, count }))
          .sort((a, b) => b.count - a.count),
      };
    },

    async queryAnalyticsDocuments(
      filters: Record<string, string>,
    ): Promise<AnalyticsDocumentsResult> {
      const activeFilters = Object.fromEntries(
        Object.entries(filters).filter(
          ([key, value]) =>
            Boolean(value?.trim()) &&
            FILTERABLE_FIELDS.some((field) => field.key === key),
        ),
      );

      let matchedIds: Set<string>;

      if (Object.keys(activeFilters).length === 0) {
        matchedIds = await listAllAnalyticsDocumentIds(doc, tableName);
      } else {
        matchedIds = await intersectFieldFilters(
          doc,
          tableName,
          activeFilters,
        );
      }

      const items = [];
      for (const documentId of matchedIds) {
        const item = await loadAnalyticsDocument(doc, tableName, documentId);
        if (item) {
          items.push(item);
        }
      }

      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      return {
        total: items.length,
        filters: activeFilters,
        items,
        fieldBreakdown: buildFieldBreakdown(items),
      };
    },
  };
}

async function listAllAnalyticsDocumentIds(
  doc: DynamoDBDocumentClient,
  tableName: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await doc.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: "SK = :sk AND entityType = :entityType",
        ExpressionAttributeValues: {
          ":sk": "ANALYTICS",
          ":entityType": "DOCUMENT_ANALYTICS",
        },
        ProjectionExpression: "documentId",
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      if (item.documentId) {
        ids.add(String(item.documentId));
      }
    }
    startKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return ids;
}

async function intersectFieldFilters(
  doc: DynamoDBDocumentClient,
  tableName: string,
  filters: Record<string, string>,
): Promise<Set<string>> {
  let intersection: Set<string> | null = null;

  for (const [key, rawValue] of Object.entries(filters)) {
    const wanted = foldText(canonicalizeSurveyAnswer(rawValue, key));
    const result = await doc.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `FIELD#${key}` },
        Limit: 500,
      }),
    );

    const ids = new Set<string>();
    for (const item of result.Items ?? []) {
      const value = String(item.fieldValue ?? "");
      if (
        foldText(canonicalizeSurveyAnswer(value, key)) === wanted &&
        item.documentId
      ) {
        ids.add(String(item.documentId));
      }
    }

    if (intersection === null) {
      intersection = ids;
    } else {
      const next = new Set<string>();
      for (const id of intersection) {
        if (ids.has(id)) {
          next.add(id);
        }
      }
      intersection = next;
    }

    if (intersection.size === 0) {
      return intersection;
    }
  }

  return intersection ?? new Set();
}

async function loadAnalyticsDocument(
  doc: DynamoDBDocumentClient,
  tableName: string,
  documentId: string,
): Promise<AnalyticsDocumentsResult["items"][number] | null> {
  const [metaResult, analyticsResult] = await Promise.all([
    doc.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `DOC#${documentId}`, SK: "META" },
      }),
    ),
    doc.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `DOC#${documentId}`, SK: "ANALYTICS" },
      }),
    ),
  ]);

  const meta = metaResult.Item;
  const analytics = analyticsResult.Item;
  if (!meta || !analytics) {
    return null;
  }

  const fields: Record<string, string> = {};
  if (Array.isArray(analytics.fields)) {
    for (const field of analytics.fields as Array<{
      key?: string;
      label?: string;
      value?: string;
    }>) {
      if (!field.key || !field.value) continue;
      const key = canonicalizeSurveyFieldKey(field.key, field.label ?? "");
      const value = canonicalizeSurveyAnswer(String(field.value), key);
      if (!value) continue;
      fields[key] = value;
    }
  }

  const metrics = (analytics.metrics ?? {}) as Record<string, number>;

  return {
    documentId,
    filename: String(meta.filename ?? analytics.filename ?? documentId),
    contentType: String(meta.contentType ?? analytics.contentType ?? ""),
    documentKind: String(analytics.documentKind ?? "generic"),
    status: meta.status as DocumentStatus,
    createdAt: String(meta.createdAt ?? analytics.createdAt ?? ""),
    fields,
    metrics: {
      lineCount: Number(metrics.lineCount ?? 0),
      wordCount: Number(metrics.wordCount ?? 0),
      avgConfidence: Number(metrics.avgConfidence ?? 0),
      fieldCount: Number(metrics.fieldCount ?? 0),
    },
  };
}

function buildFieldBreakdown(
  items: AnalyticsDocumentsResult["items"],
): AnalyticsDocumentsResult["fieldBreakdown"] {
  const breakdown: AnalyticsDocumentsResult["fieldBreakdown"] = [];

  for (const field of SURVEY_KAP_FIELDS) {
    const rawValues: string[] = [];
    for (const item of items) {
      const value = item.fields[field.key];
      if (!value) continue;
      rawValues.push(value);
    }
    if (rawValues.length === 0) continue;
    breakdown.push({
      key: field.key,
      label: field.label,
      values: mergeAnswerCounts(rawValues, field.key).slice(0, 30),
    });
  }

  return breakdown;
}

function encodeCursor(key: DynamoItem | undefined): string | undefined {
  if (!key) {
    return undefined;
  }
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

function sanitizeSortValue(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .slice(0, 80) || "value"
  );
}

function decodeCursor(
  cursor: string | undefined,
): Record<string, unknown> | undefined {
  if (!cursor) {
    return undefined;
  }
  try {
    return JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
