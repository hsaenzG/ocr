import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { createDynamoDocumentStore } from "./adapters/dynamoDocumentStore.js";
import { createS3ObjectReader } from "./adapters/s3ObjectReader.js";
import { createTextractOcrEngine } from "./adapters/textractOcrEngine.js";
import { createTextractAsyncOcrEngine } from "./adapters/textractAsyncOcrEngine.js";
import { createClock } from "./adapters/systemClock.js";
import { createIdGenerator } from "./adapters/uuidGenerator.js";
import { parseS3ObjectCreatedFromSqsBody } from "./parseSqsS3Event.js";
import {
  createProcessDocumentUseCase,
  NonRetryableProcessingError,
} from "./useCases/processDocument.js";

const tableName = process.env.TABLE_NAME ?? "";
const snsTopicArn = process.env.TEXTRACT_TOPIC_ARN ?? "";
const snsRoleArn = process.env.TEXTRACT_PUBLISH_ROLE_ARN ?? "";

const processDocument = createProcessDocumentUseCase({
  documents: createDynamoDocumentStore({ tableName }),
  objectReader: createS3ObjectReader(),
  ocr: createTextractOcrEngine(),
  asyncOcr: createTextractAsyncOcrEngine({ snsTopicArn, snsRoleArn }),
  clock: createClock(),
  ids: createIdGenerator(),
});

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    try {
      const refs = parseS3ObjectCreatedFromSqsBody(record.body);
      if (refs.length === 0) {
        console.warn("No S3 refs in SQS message", { messageId: record.messageId });
        continue;
      }

      for (const ref of refs) {
        await processDocument.execute(ref);
      }
    } catch (error) {
      if (error instanceof NonRetryableProcessingError) {
        console.error("Non-retryable processing error", {
          messageId: record.messageId,
          code: error.code,
          message: error.message,
        });
        continue;
      }
      console.error("Retryable processing error", {
        messageId: record.messageId,
        error,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
