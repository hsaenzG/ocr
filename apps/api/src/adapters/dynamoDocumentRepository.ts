import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import type {
  DocumentDetail,
  DocumentListQuery,
  DocumentListResult,
  DocumentMetaRecord,
  DocumentRepository,
  DocumentStatus,
  StatsSummary,
} from "../ports.js";

type DynamoItem = Record<string, unknown>;

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
      const metaItem = {
        PK: `DOC#${meta.documentId}`,
        SK: "META",
        entityType: "DOCUMENT",
        ...meta,
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
  };
}

function encodeCursor(key: DynamoItem | undefined): string | undefined {
  if (!key) {
    return undefined;
  }
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
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
