import type {
  Clock,
  DocumentRepository,
  IdGenerator,
  ObjectStore,
} from "../ports.js";
import {
  isAllowedContentType,
  isPdfContentType,
  type PresignFileRequest,
  type PresignUploadsResponse,
} from "@ocr/shared";

const MAX_FILES_PER_REQUEST = 25;

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function createPresignUploadsUseCase(deps: {
  documents: DocumentRepository;
  objectStore: ObjectStore;
  clock: Clock;
  ids: IdGenerator;
  uploadPrefix: string;
  maxUploadBytes: number;
  maxPdfUploadBytes: number;
  docsBucketName: string;
}) {
  return {
    async execute(files: PresignFileRequest[]): Promise<PresignUploadsResponse> {
      if (!Array.isArray(files) || files.length === 0) {
        throw new HttpError(400, "INVALID_BODY", "files must be a non-empty array");
      }
      if (files.length > MAX_FILES_PER_REQUEST) {
        throw new HttpError(
          400,
          "TOO_MANY_FILES",
          `At most ${MAX_FILES_PER_REQUEST} files per request`,
        );
      }

      const now = deps.clock.nowIso();
      const dayPath = now.slice(0, 10).replaceAll("-", "/");
      const uploads = [];

      for (const file of files) {
        if (!file.filename || !file.contentType) {
          throw new HttpError(
            400,
            "INVALID_FILE",
            "Each file requires filename and contentType",
          );
        }
        if (!isAllowedContentType(file.contentType)) {
          throw new HttpError(
            400,
            "UNSUPPORTED_CONTENT_TYPE",
            `Only image/jpeg, image/png and application/pdf allowed (got ${file.contentType})`,
          );
        }

        const maxBytes = isPdfContentType(file.contentType)
          ? deps.maxPdfUploadBytes
          : deps.maxUploadBytes;
        if (
          !Number.isFinite(file.sizeBytes) ||
          file.sizeBytes <= 0 ||
          file.sizeBytes > maxBytes
        ) {
          throw new HttpError(
            400,
            "INVALID_SIZE",
            `sizeBytes must be between 1 and ${maxBytes} for ${file.contentType}`,
          );
        }

        const documentId = deps.ids.newId();
        const safeFilename = sanitizeFilename(file.filename);
        const s3Key = `${trimSlash(deps.uploadPrefix)}/${dayPath}/${documentId}/${safeFilename}`;

        const uploadUrl = await deps.objectStore.createPresignedPut({
          key: s3Key,
          contentType: file.contentType,
          metadata: {
            "document-id": documentId,
            "original-filename": safeFilename,
          },
          expiresInSeconds: 900,
        });

        await deps.documents.putUploadedDocument({
          documentId,
          filename: safeFilename,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          s3Bucket: deps.docsBucketName,
          s3Key,
          status: "UPLOADED",
          createdAt: now,
          updatedAt: now,
          errorMessage: null,
          // If the browser never PUTs, Dynamo TTL drops META + listing projections.
          expiresAt: Math.floor(Date.parse(now) / 1000) + 60 * 60 * 24,
        });

        uploads.push({
          documentId,
          s3Key,
          uploadUrl,
          // Only Content-Type: metadata rides on the signed URL query string.
          // Re-sending x-amz-meta-* headers causes S3 403 SignatureDoesNotMatch.
          headers: {
            "Content-Type": file.contentType,
          },
        });
      }

      return { uploads };
    },
  };
}

function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "document";
  return base.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 180) || "document";
}

function trimSlash(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}
