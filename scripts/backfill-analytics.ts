#!/usr/bin/env node
/**
 * Backfill / refresh DOCUMENT_ANALYTICS for existing EXTRACT items.
 * Usage:
 *   TABLE_NAME=... npx tsx scripts/backfill-analytics.ts
 *   TABLE_NAME=... FORCE=1 npx tsx scripts/backfill-analytics.ts
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { createDynamoAnalyticsStore } from "../apps/processor/src/adapters/dynamoAnalyticsStore.js";
import {
  createBedrockDocumentParser,
  createDocumentAnalyticsParser,
} from "../apps/processor/src/analytics/bedrockParser.js";
import { createHeuristicDocumentParser } from "../apps/processor/src/analytics/heuristicParser.js";
import { createTabulateExtractUseCase } from "../apps/processor/src/useCases/tabulateExtract.js";

const tableName = process.env.TABLE_NAME;
if (!tableName) {
  console.error("Set TABLE_NAME");
  process.exit(1);
}

const force = process.env.FORCE === "1" || process.env.FORCE === "true";
const bedrockModelId =
  process.env.BEDROCK_MODEL_ID ?? "amazon.nova-lite-v1:0";
const useBedrock = (process.env.ANALYTICS_PARSER ?? "bedrock") !== "heuristic";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const fallback = createHeuristicDocumentParser();
const parser = createDocumentAnalyticsParser({
  primary: useBedrock
    ? createBedrockDocumentParser({ modelId: bedrockModelId })
    : undefined,
  fallback,
});

const tabulate = createTabulateExtractUseCase({
  analytics: createDynamoAnalyticsStore({ tableName, client: doc }),
  parser,
});

async function main() {
  let lastKey: Record<string, unknown> | undefined;
  let processed = 0;

  console.log("Backfill analytics", {
    tableName,
    force,
    parser: useBedrock ? `bedrock:${bedrockModelId}` : "heuristic",
  });

  do {
    const page = await doc.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: "SK = :sk",
        ExpressionAttributeValues: { ":sk": "EXTRACT" },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of page.Items ?? []) {
      const documentId = String(item.documentId);
      await tabulate.execute({
        documentId,
        plainText: String(item.plainText ?? ""),
        lineCount: Number(item.lineCount ?? 0),
        avgConfidence: Number(item.avgConfidence ?? 0),
        createdAt: String(item.createdAt ?? new Date().toISOString()),
        force,
      });
      processed += 1;
      console.log("backfilled", documentId);
    }

    lastKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  console.log(`Done. Processed ${processed} EXTRACT items.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
