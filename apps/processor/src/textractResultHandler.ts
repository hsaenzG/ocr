import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { createDynamoDocumentStore } from "./adapters/dynamoDocumentStore.js";
import { createTextractAsyncOcrEngine } from "./adapters/textractAsyncOcrEngine.js";
import { createClock } from "./adapters/systemClock.js";
import { parseTextractNotificationFromSqsBody } from "./parseTextractNotification.js";
import { createCompleteAsyncOcrUseCase } from "./useCases/completeAsyncOcr.js";
import { NonRetryableProcessingError } from "./useCases/processDocument.js";

const tableName = process.env.TABLE_NAME ?? "";

const completeAsyncOcr = createCompleteAsyncOcrUseCase({
  documents: createDynamoDocumentStore({ tableName }),
  asyncOcr: createTextractAsyncOcrEngine({
    snsTopicArn: process.env.TEXTRACT_TOPIC_ARN ?? "",
    snsRoleArn: process.env.TEXTRACT_PUBLISH_ROLE_ARN ?? "",
  }),
  clock: createClock(),
});

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    try {
      const notification = parseTextractNotificationFromSqsBody(record.body);
      if (!notification) {
        console.warn("Unparseable Textract notification", {
          messageId: record.messageId,
        });
        continue;
      }

      await completeAsyncOcr.execute(notification);
    } catch (error) {
      if (error instanceof NonRetryableProcessingError) {
        console.error("Non-retryable Textract completion error", {
          messageId: record.messageId,
          code: error.code,
          message: error.message,
        });
        continue;
      }
      console.error("Retryable Textract completion error", {
        messageId: record.messageId,
        error,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
