import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  DocumentMeta,
  DocumentStatus,
  DocumentStore,
  OcrResult,
} from "../ports.js";

export function createDynamoDocumentStore(deps: {
  tableName: string;
  client?: DynamoDBDocumentClient;
}): DocumentStore {
  const doc =
    deps.client ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  const tableName = deps.tableName;

  return {
    async getMeta(documentId: string): Promise<DocumentMeta | null> {
      const result = await doc.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: `DOC#${documentId}`, SK: "META" },
        }),
      );
      if (!result.Item) {
        return null;
      }
      return mapMeta(result.Item);
    },

    async getMetaByS3Key(
      _bucket: string,
      key: string,
    ): Promise<DocumentMeta | null> {
      const fromKey = documentIdFromKey(key);
      if (!fromKey) {
        return null;
      }
      return this.getMeta(fromKey);
    },

    async markProcessing(
      documentId: string,
      jobId: string,
      startedAt: string,
    ): Promise<void> {
      const meta = await this.getMeta(documentId);
      if (!meta) {
        throw new Error(`Document ${documentId} not found`);
      }

      await transitionStatus(doc, tableName, meta, "PROCESSING", startedAt);
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            PK: `DOC#${documentId}`,
            SK: `JOB#${jobId}`,
            entityType: "JOB",
            documentId,
            jobId,
            status: "PROCESSING",
            attempt: 1,
            startedAt,
          },
        }),
      );
    },

    async markCompleted(input: {
      documentId: string;
      jobId: string;
      extract: OcrResult;
      startedAt: string;
      endedAt: string;
    }): Promise<void> {
      const meta = await this.getMeta(input.documentId);
      if (!meta) {
        throw new Error(`Document ${input.documentId} not found`);
      }

      const durationMs =
        Date.parse(input.endedAt) - Date.parse(input.startedAt);

      await transitionStatus(
        doc,
        tableName,
        meta,
        "COMPLETED",
        input.endedAt,
        input.endedAt,
      );

      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            PK: `DOC#${input.documentId}`,
            SK: "EXTRACT",
            entityType: "EXTRACT",
            documentId: input.documentId,
            engine: input.extract.engine,
            mode: input.extract.mode,
            plainText: input.extract.plainText,
            lineCount: input.extract.lineCount,
            avgConfidence: input.extract.avgConfidence,
            createdAt: input.endedAt,
          },
        }),
      );

      await doc.send(
        new UpdateCommand({
          TableName: tableName,
          Key: {
            PK: `DOC#${input.documentId}`,
            SK: `JOB#${input.jobId}`,
          },
          UpdateExpression:
            "SET #status = :status, endedAt = :endedAt, durationMs = :durationMs",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":status": "COMPLETED",
            ":endedAt": input.endedAt,
            ":durationMs": durationMs,
          },
        }),
      );

      await bumpDailyStats(doc, tableName, input.endedAt.slice(0, 10), {
        completed: 1,
      });
    },

    async markFailed(input: {
      documentId: string;
      jobId: string;
      startedAt: string;
      endedAt: string;
      errorCode: string;
      errorMessage: string;
    }): Promise<void> {
      const meta = await this.getMeta(input.documentId);
      if (!meta) {
        throw new Error(`Document ${input.documentId} not found`);
      }

      const durationMs =
        Date.parse(input.endedAt) - Date.parse(input.startedAt);

      await transitionStatus(
        doc,
        tableName,
        meta,
        "FAILED",
        input.endedAt,
        undefined,
        input.errorMessage,
      );

      await doc.send(
        new UpdateCommand({
          TableName: tableName,
          Key: {
            PK: `DOC#${input.documentId}`,
            SK: `JOB#${input.jobId}`,
          },
          UpdateExpression:
            "SET #status = :status, endedAt = :endedAt, durationMs = :durationMs, errorCode = :errorCode, errorMessage = :errorMessage",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":status": "FAILED",
            ":endedAt": input.endedAt,
            ":durationMs": durationMs,
            ":errorCode": input.errorCode,
            ":errorMessage": input.errorMessage,
          },
        }),
      );

      await bumpDailyStats(doc, tableName, input.endedAt.slice(0, 10), {
        failed: 1,
      });
    },
  };
}

async function transitionStatus(
  doc: DynamoDBDocumentClient,
  tableName: string,
  meta: DocumentMeta,
  nextStatus: DocumentStatus,
  updatedAt: string,
  completedAt?: string,
  errorMessage?: string,
): Promise<void> {
  await doc.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `DOC#${meta.documentId}`, SK: "META" },
      UpdateExpression:
        "SET #status = :status, updatedAt = :updatedAt, completedAt = :completedAt, errorMessage = :errorMessage",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": nextStatus,
        ":updatedAt": updatedAt,
        ":completedAt": completedAt ?? null,
        ":errorMessage": errorMessage ?? null,
      },
    }),
  );

  await doc.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: "DOCS",
        SK: `TS#${meta.createdAt}#DOC#${meta.documentId}`,
      },
      UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": nextStatus,
        ":updatedAt": updatedAt,
      },
    }),
  );

  await doc.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: `STATUS#${meta.status}`,
        SK: `TS#${meta.createdAt}#DOC#${meta.documentId}`,
      },
    }),
  );

  await doc.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `STATUS#${nextStatus}`,
        SK: `TS#${meta.createdAt}#DOC#${meta.documentId}`,
        entityType: "STATUS_ITEM",
        documentId: meta.documentId,
        filename: meta.filename,
        status: nextStatus,
        contentType: meta.contentType,
        createdAt: meta.createdAt,
        updatedAt,
      },
    }),
  );
}

async function bumpDailyStats(
  doc: DynamoDBDocumentClient,
  tableName: string,
  date: string,
  deltas: Partial<{
    uploaded: number;
    completed: number;
    failed: number;
    processing: number;
  }>,
): Promise<void> {
  const addParts: string[] = [];
  const values: Record<string, number | string> = {
    ":date": date,
    ":updatedAt": new Date().toISOString(),
    ":entityType": "DAILY_STATS",
  };

  for (const [field, amount] of Object.entries(deltas)) {
    if (!amount) {
      continue;
    }
    values[`:${field}`] = amount;
    addParts.push(`${field} :${field}`);
  }

  if (addParts.length === 0) {
    return;
  }

  await doc.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: "STATS#DAILY", SK: `DATE#${date}` },
      UpdateExpression: `SET #date = if_not_exists(#date, :date), entityType = if_not_exists(entityType, :entityType), updatedAt = :updatedAt ADD ${addParts.join(", ")}`,
      ExpressionAttributeNames: { "#date": "date" },
      ExpressionAttributeValues: values,
    }),
  );
}

function mapMeta(item: Record<string, unknown>): DocumentMeta {
  return {
    documentId: String(item.documentId),
    filename: String(item.filename),
    contentType: String(item.contentType),
    sizeBytes: Number(item.sizeBytes),
    s3Bucket: String(item.s3Bucket),
    s3Key: String(item.s3Key),
    status: item.status as DocumentStatus,
    createdAt: String(item.createdAt),
    updatedAt: String(item.updatedAt),
  };
}

function documentIdFromKey(key: string): string | null {
  // uploads/yyyy/mm/dd/<documentId>/<filename>
  const parts = key.split("/");
  if (parts.length < 6) {
    return null;
  }
  return parts[parts.length - 2] ?? null;
}
