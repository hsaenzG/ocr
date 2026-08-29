export const ALLOWED_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
] as const;

export type AllowedImageContentType =
  (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number];

export type DocumentStatus =
  | "UPLOADED"
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

export interface PresignFileRequest {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface PresignUploadItem {
  documentId: string;
  s3Key: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

export interface PresignUploadsResponse {
  uploads: PresignUploadItem[];
}

export interface DocumentListItem {
  documentId: string;
  filename: string;
  status: DocumentStatus;
  contentType: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentMeta {
  documentId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  s3Bucket: string;
  s3Key: string;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  errorMessage?: string | null;
}

export interface DocumentExtract {
  documentId: string;
  engine: string;
  mode: string;
  plainText: string;
  lineCount: number;
  avgConfidence: number;
  createdAt: string;
}

export interface DocumentJob {
  jobId: string;
  documentId: string;
  status: DocumentStatus;
  attempt: number;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface DocumentDetailResponse {
  meta: DocumentMeta;
  extract?: DocumentExtract;
  jobs?: DocumentJob[];
}

export interface StatsSummaryResponse {
  totals: {
    uploaded: number;
    completed: number;
    failed: number;
    processing: number;
  };
  series: Array<{
    date: string;
    uploaded: number;
    completed: number;
    failed: number;
    processing: number;
  }>;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  code: string;
}

export function isAllowedImageContentType(
  contentType: string,
): contentType is AllowedImageContentType {
  return (ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(
    contentType,
  );
}
