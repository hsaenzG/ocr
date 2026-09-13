import type { AsyncOcrEngine, Clock, DocumentStore } from "../ports.js";
import { NonRetryableProcessingError } from "./processDocument.js";
import type { TextractNotification } from "../parseTextractNotification.js";

export function createCompleteAsyncOcrUseCase(deps: {
  documents: DocumentStore;
  asyncOcr: AsyncOcrEngine;
  clock: Clock;
}) {
  return {
    async execute(notification: TextractNotification): Promise<void> {
      const link = await deps.documents.findTextractJobLink(
        notification.textractJobId,
      );
      if (!link) {
        throw new NonRetryableProcessingError(
          "TEXTRACT_JOB_NOT_LINKED",
          `No document linked to Textract job ${notification.textractJobId}`,
        );
      }

      const meta = await deps.documents.getMeta(link.documentId);
      if (meta?.status === "COMPLETED") {
        console.log("Skipping already completed document", {
          documentId: link.documentId,
        });
        return;
      }

      if (notification.status === "FAILED") {
        await deps.documents.markFailed({
          documentId: link.documentId,
          jobId: link.jobId,
          startedAt: link.startedAt,
          endedAt: deps.clock.nowIso(),
          errorCode: "OCR_FAILED",
          errorMessage:
            notification.statusMessage ??
            `Textract job ${notification.textractJobId} failed`,
        });
        return;
      }

      const extract = await deps.asyncOcr.fetchTextDetection(
        notification.textractJobId,
      );

      await deps.documents.markCompleted({
        documentId: link.documentId,
        jobId: link.jobId,
        extract,
        startedAt: link.startedAt,
        endedAt: deps.clock.nowIso(),
      });
    },
  };
}
