import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  canonicalizeSurveyAnswer,
  canonicalizeSurveyFieldKey,
  surveyFieldLabel,
  type DocumentAnalytics,
  type DocumentKind,
} from "@ocr/shared";
import type { ParsedDocumentAnalytics } from "../analytics/types.js";

export interface AnalyticsStore {
  getMetaBasics(documentId: string): Promise<{
    filename: string;
    contentType: string;
  } | null>;
  putDocumentAnalytics(input: {
    documentId: string;
    filename?: string;
    contentType?: string;
    parsed: ParsedDocumentAnalytics;
    createdAt: string;
    force?: boolean;
  }): Promise<void>;
}

export function createDynamoAnalyticsStore(deps: {
  tableName: string;
  client?: DynamoDBDocumentClient;
}): AnalyticsStore {
  const doc =
    deps.client ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  const tableName = deps.tableName;

  return {
    async getMetaBasics(documentId) {
      const result = await doc.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: `DOC#${documentId}`, SK: "META" },
        }),
      );
      if (!result.Item) {
        return null;
      }
      return {
        filename: String(result.Item.filename ?? ""),
        contentType: String(result.Item.contentType ?? "application/octet-stream"),
      };
    },

    async putDocumentAnalytics(input) {
      const existing = await doc.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: `DOC#${input.documentId}`, SK: "ANALYTICS" },
        }),
      );
      if (existing.Item && !input.force) {
        console.log("Analytics already present, skipping", {
          documentId: input.documentId,
        });
        return;
      }

      if (existing.Item && input.force) {
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
            canonicalizeSurveyAnswer(field.value, fieldKey),
          );
          await doc.send(
            new DeleteCommand({
              TableName: tableName,
              Key: {
                PK: `FIELD#${fieldKey}`,
                SK: `VALUE#${valueKey}#DOC#${input.documentId}`,
              },
            }),
          );
        }
      }

      const contentType =
        input.contentType ?? "application/octet-stream";
      const filename = input.filename ?? "";
      const kind = input.parsed.documentKind;
      const date = input.createdAt.slice(0, 10);

      const normalizedFields = input.parsed.fields.map((field) => {
        const key = canonicalizeSurveyFieldKey(field.key, field.label);
        const value = canonicalizeSurveyAnswer(field.value, key);
        return {
          ...field,
          key,
          label: surveyFieldLabel(key) || field.label,
          value,
        };
      });

      const analyticsItem: DocumentAnalytics & {
        PK: string;
        SK: string;
        entityType: string;
        parser: string;
      } = {
        PK: `DOC#${input.documentId}`,
        SK: "ANALYTICS",
        entityType: "DOCUMENT_ANALYTICS",
        documentId: input.documentId,
        documentKind: kind,
        filename,
        contentType,
        fields: normalizedFields,
        metrics: {
          ...input.parsed.metrics,
          fieldCount: normalizedFields.length,
        },
        tableRows: normalizedFields.map((field) => ({
          key: field.label,
          value: field.value,
        })),
        createdAt: input.createdAt,
        parser: input.parsed.parser,
      };

      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: analyticsItem,
        }),
      );

      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            PK: `KIND#${kind}`,
            SK: `DATE#${date}#DOC#${input.documentId}`,
            entityType: "ANALYTICS_KIND_ITEM",
            documentId: input.documentId,
            documentKind: kind,
            contentType,
            createdAt: input.createdAt,
          },
        }),
      );

      for (const field of normalizedFields) {
        const valueKey = sanitizeSortValue(field.value);
        await doc.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              PK: `FIELD#${field.key}`,
              SK: `VALUE#${valueKey}#DOC#${input.documentId}`,
              entityType: "ANALYTICS_FIELD_ITEM",
              documentId: input.documentId,
              fieldKey: field.key,
              fieldLabel: field.label,
              fieldValue: field.value,
              createdAt: input.createdAt,
            },
          }),
        );
      }

      // Only bump daily rollups on first analysis to avoid double-counting re-runs.
      if (!existing.Item) {
        await bumpDailyAnalytics(doc, tableName, date, {
          documentsAnalyzed: 1,
          totalLines: input.parsed.metrics.lineCount,
          totalWords: input.parsed.metrics.wordCount,
          confidenceSum: input.parsed.metrics.avgConfidence,
          contentType,
          kind,
        });
      }
    },
  };
}

async function bumpDailyAnalytics(
  doc: DynamoDBDocumentClient,
  tableName: string,
  date: string,
  deltas: {
    documentsAnalyzed: number;
    totalLines: number;
    totalWords: number;
    confidenceSum: number;
    contentType: string;
    kind: DocumentKind;
  },
): Promise<void> {
  const contentTypeAttr = contentTypeCounter(deltas.contentType);
  const kindAttr = `kind_${deltas.kind}`;

  await doc.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: "STATS#ANALYTICS#DAILY", SK: `DATE#${date}` },
      UpdateExpression: `
        SET #date = if_not_exists(#date, :date),
            entityType = if_not_exists(entityType, :entityType),
            updatedAt = :updatedAt
        ADD documentsAnalyzed :documentsAnalyzed,
            totalLines :totalLines,
            totalWords :totalWords,
            confidenceSum :confidenceSum,
            ${contentTypeAttr} :one,
            ${kindAttr} :one
      `,
      ExpressionAttributeNames: { "#date": "date" },
      ExpressionAttributeValues: {
        ":date": date,
        ":entityType": "ANALYTICS_DAILY_STATS",
        ":updatedAt": new Date().toISOString(),
        ":documentsAnalyzed": deltas.documentsAnalyzed,
        ":totalLines": deltas.totalLines,
        ":totalWords": deltas.totalWords,
        ":confidenceSum": deltas.confidenceSum,
        ":one": 1,
      },
    }),
  );
}

function contentTypeCounter(contentType: string): string {
  if (contentType === "application/pdf") return "contentTypePdf";
  if (contentType === "image/png") return "contentTypePng";
  if (contentType === "image/jpeg") return "contentTypeJpeg";
  return "contentTypeOther";
}

function sanitizeSortValue(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80) || "value";
}

export async function queryAnalyticsSummary(
  deps: { tableName: string; client?: DynamoDBDocumentClient },
  fromDate: string,
  toDate: string,
): Promise<{
  totals: {
    documentsAnalyzed: number;
    avgConfidence: number;
    totalLines: number;
    totalWords: number;
  };
  series: Array<{
    date: string;
    documentsAnalyzed: number;
    avgConfidence: number;
    totalLines: number;
    totalWords: number;
    byContentType: Record<string, number>;
    byKind: Record<string, number>;
  }>;
  fields: Array<{
    key: string;
    values: Array<{ value: string; count: number }>;
  }>;
  kinds: Array<{ kind: string; count: number }>;
}> {
  const doc =
    deps.client ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });

  const daily = await doc.send(
    new QueryCommand({
      TableName: deps.tableName,
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

  const totals = series.reduce(
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

  const trackedFields = [
    "codigo",
    "profesion",
    "genero",
    "edad",
    "anios_graduado",
    "total",
  ];
  const fields = [];
  for (const key of trackedFields) {
    const result = await doc.send(
      new QueryCommand({
        TableName: deps.tableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `FIELD#${key}` },
        Limit: 200,
      }),
    );
    const counts = new Map<string, number>();
    for (const item of result.Items ?? []) {
      const value = String(item.fieldValue ?? "");
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    if (counts.size === 0) continue;
    fields.push({
      key,
      values: [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12),
    });
  }

  return {
    totals: {
      documentsAnalyzed: totals.documentsAnalyzed,
      avgConfidence:
        totals.documentsAnalyzed === 0
          ? 0
          : Number(
              (totals.confidenceWeighted / totals.documentsAnalyzed).toFixed(2),
            ),
      totalLines: totals.totalLines,
      totalWords: totals.totalWords,
    },
    series,
    fields,
    kinds: [...kindTotals.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count),
  };
}
