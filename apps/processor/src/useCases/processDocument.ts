import {
  isAllowedImageContentType,
  isPdfContentType,
} from "@ocr/shared";
import type {
  AsyncOcrEngine,
  Clock,
  DocumentStore,
  IdGenerator,
  ObjectReader,
  OcrEngine,
} from "../ports.js";

export class NonRetryableProcessingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NonRetryableProcessingError";
  }
}

export function createProcessDocumentUseCase(deps: {
  documents: DocumentStore;
  objectReader: ObjectReader;
  ocr: OcrEngine;
  asyncOcr: AsyncOcrEngine;
  clock: Clock;
  ids: IdGenerator;
}) {
  return {
    async execute(input: { bucket: string; key: string }): Promise<void> {
      const objectMeta = await deps.objectReader.getObjectMetadata(
        input.bucket,
        input.key,
      );

      const documentId =
        objectMeta.documentId ?? documentIdFromKey(input.key) ?? undefined;
      if (!documentId) {
        throw new NonRetryableProcessingError(
          "MISSING_DOCUMENT_ID",
          `Cannot resolve documentId for s3://${input.bucket}/${input.key}`,
        );
      }

      const meta =
        (await deps.documents.getMeta(documentId)) ??
        (await deps.documents.getMetaByS3Key(input.bucket, input.key));

      if (!meta) {
        throw new NonRetryableProcessingError(
          "DOCUMENT_NOT_FOUND",
          `No META for documentId=${documentId}`,
        );
      }

      if (meta.status === "COMPLETED") {
        console.log("Skipping already completed document", { documentId });
        return;
      }

      const contentType = objectMeta.contentType ?? meta.contentType;
      const jobId = deps.ids.newId();
      const startedAt = deps.clock.nowIso();

      if (isPdfContentType(contentType)) {
        await deps.documents.markProcessing(documentId, jobId, startedAt);
        await startAsyncJob({
          deps,
          documentId,
          jobId,
          startedAt,
          bucket: input.bucket,
          key: input.key,
        });
        return;
      }

      if (!isAllowedImageContentType(contentType)) {
        await deps.documents.markProcessing(documentId, jobId, startedAt);
        await deps.documents.markFailed({
          documentId,
          jobId,
          startedAt,
          endedAt: deps.clock.nowIso(),
          errorCode: "UNSUPPORTED_CONTENT_TYPE",
          errorMessage: `Unsupported content type: ${contentType}`,
        });
        return;
      }

      await deps.documents.markProcessing(documentId, jobId, startedAt);

      try {
        const extract = await deps.ocr.extractText(input.bucket, input.key);
        await deps.documents.markCompleted({
          documentId,
          jobId,
          extract,
          startedAt,
          endedAt: deps.clock.nowIso(),
        });
      } catch (error) {
        if (isLikelyTransient(error)) {
          throw error;
        }
        await deps.documents.markFailed({
          documentId,
          jobId,
          startedAt,
          endedAt: deps.clock.nowIso(),
          errorCode: "OCR_FAILED",
          errorMessage: errorMessageOf(error, "Unknown OCR failure"),
        });
      }
    },
  };
}

/**
 * PDFs are handed to Textract as a job; completion arrives later via SNS → SQS,
 * so the document stays PROCESSING until the result handler runs.
 */
async function startAsyncJob(input: {
  deps: {
    documents: DocumentStore;
    asyncOcr: AsyncOcrEngine;
    clock: Clock;
  };
  documentId: string;
  jobId: string;
  startedAt: string;
  bucket: string;
  key: string;
}): Promise<void> {
  const { deps, documentId, jobId, startedAt } = input;

  try {
    const { textractJobId } = await deps.asyncOcr.startTextDetection({
      bucket: input.bucket,
      key: input.key,
      clientRequestToken: jobId,
      jobTag: documentId,
    });

    await deps.documents.linkTextractJob({
      textractJobId,
      documentId,
      jobId,
      startedAt,
    });

    console.log("Started async Textract job", {
      documentId,
      jobId,
      textractJobId,
    });
  } catch (error) {
    if (isLikelyTransient(error)) {
      throw error;
    }
    await deps.documents.markFailed({
      documentId,
      jobId,
      startedAt,
      endedAt: deps.clock.nowIso(),
      errorCode: "OCR_START_FAILED",
      errorMessage: errorMessageOf(error, "Could not start Textract job"),
    });
  }
}

function documentIdFromKey(key: string): string | null {
  const parts = key.split("/");
  if (parts.length < 6) {
    return null;
  }
  return parts[parts.length - 2] ?? null;
}

function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isLikelyTransient(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }
  const name = error.name.toLowerCase();
  return (
    name.includes("throttl") ||
    name.includes("timeout") ||
    name.includes("service") ||
    name.includes("unavailable")
  );
}
