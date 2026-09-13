import type {
  DynamoDBBatchResponse,
  DynamoDBStreamEvent,
  DynamoDBRecord,
} from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { createDynamoAnalyticsStore } from "./adapters/dynamoAnalyticsStore.js";
import {
  createBedrockDocumentParser,
  createDocumentAnalyticsParser,
} from "./analytics/bedrockParser.js";
import { createHeuristicDocumentParser } from "./analytics/heuristicParser.js";
import { createTabulateExtractUseCase } from "./useCases/tabulateExtract.js";

const tableName = process.env.TABLE_NAME ?? "";
const bedrockModelId =
  process.env.BEDROCK_MODEL_ID ?? "amazon.nova-lite-v1:0";
const useBedrock = (process.env.ANALYTICS_PARSER ?? "bedrock") !== "heuristic";

const fallback = createHeuristicDocumentParser();
const parser = createDocumentAnalyticsParser({
  primary: useBedrock
    ? createBedrockDocumentParser({ modelId: bedrockModelId })
    : undefined,
  fallback,
});

const tabulateExtract = createTabulateExtractUseCase({
  analytics: createDynamoAnalyticsStore({ tableName }),
  parser,
});

export async function handler(
  event: DynamoDBStreamEvent,
): Promise<DynamoDBBatchResponse> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    try {
      await handleRecord(record);
    } catch (error) {
      console.error("Analytics stream record failed", {
        eventID: record.eventID,
        sequenceNumber: record.dynamodb?.SequenceNumber,
        error,
      });
      if (record.dynamodb?.SequenceNumber) {
        batchItemFailures.push({
          itemIdentifier: record.dynamodb.SequenceNumber,
        });
      }
    }
  }

  return { batchItemFailures };
}

async function handleRecord(record: DynamoDBRecord): Promise<void> {
  if (record.eventName !== "INSERT" && record.eventName !== "MODIFY") {
    return;
  }
  if (!record.dynamodb?.NewImage) {
    return;
  }

  const image = unmarshall(
    record.dynamodb.NewImage as Record<string, AttributeValue>,
  );

  if (image.entityType !== "EXTRACT" && image.SK !== "EXTRACT") {
    return;
  }

  const documentId = String(image.documentId ?? "");
  const plainText = String(image.plainText ?? "");
  if (!documentId || !plainText) {
    console.warn("EXTRACT stream record missing documentId/plainText", {
      eventID: record.eventID,
    });
    return;
  }

  await tabulateExtract.execute({
    documentId,
    plainText,
    lineCount: Number(image.lineCount ?? 0),
    avgConfidence: Number(image.avgConfidence ?? 0),
    createdAt: String(image.createdAt ?? new Date().toISOString()),
  });
}
