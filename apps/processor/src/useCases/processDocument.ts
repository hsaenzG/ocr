import { isAllowedImageContentType } from "@ocr/shared";
import type {
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
      if (!isAllowedImageContentType(contentType)) {
        const jobId = deps.ids.newId();
        const startedAt = deps.clock.nowIso();
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

      const jobId = deps.ids.newId();
      const startedAt = deps.clock.nowIso();
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
        const message =
          error instanceof Error ? error.message : "Unknown OCR failure";
        await deps.documents.markFailed({
          documentId,
          jobId,
          startedAt,
          endedAt: deps.clock.nowIso(),
          errorCode: "OCR_FAILED",
          errorMessage: message,
        });
      }
    },
  };
}

function documentIdFromKey(key: string): string | null {
  const parts = key.split("/");
  if (parts.length < 6) {
    return null;
  }
  return parts[parts.length - 2] ?? null;
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
