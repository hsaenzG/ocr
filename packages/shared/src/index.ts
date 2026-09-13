export const ALLOWED_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
] as const;

export const PDF_CONTENT_TYPE = "application/pdf" as const;

export const ALLOWED_CONTENT_TYPES = [
  ...ALLOWED_IMAGE_CONTENT_TYPES,
  PDF_CONTENT_TYPE,
] as const;

export type AllowedImageContentType =
  (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number];

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

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

export type DocumentKind =
  | "survey_kap"
  | "invoice"
  | "receipt"
  | "generic";

export interface AnalyticsField {
  key: string;
  label: string;
  value: string;
  source: "label_value" | "keyword" | "metric" | "bedrock" | "manual";
}

export interface DocumentAnalytics {
  documentId: string;
  documentKind: DocumentKind;
  filename?: string;
  contentType?: string;
  fields: AnalyticsField[];
  metrics: {
    lineCount: number;
    wordCount: number;
    charCount: number;
    avgConfidence: number;
    fieldCount: number;
  };
  tableRows: Array<{ key: string; value: string }>;
  createdAt: string;
}

export interface AnalyticsSummaryResponse {
  totals: {
    documentsAnalyzed: number;
    avgConfidence: number;
    totalLines: number;
    totalWords: number;
  };
  series: Array<{
    date: string;
    documentsAnalyzed: number;
    avgConfidence: number;
    totalLines: number;
    totalWords: number;
    byContentType: Record<string, number>;
    byKind: Record<string, number>;
  }>;
  fields: Array<{
    key: string;
    values: Array<{ value: string; count: number }>;
  }>;
  kinds: Array<{ kind: string; count: number }>;
}

export interface DocumentDetailResponse {
  meta: DocumentMeta;
  extract?: DocumentExtract;
  analytics?: DocumentAnalytics;
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

export function isPdfContentType(contentType: string): boolean {
  return contentType === PDF_CONTENT_TYPE;
}

/** Images run through sync Textract; PDFs go through the async job flow. */
export function isAllowedContentType(
  contentType: string,
): contentType is AllowedContentType {
  return isAllowedImageContentType(contentType) || isPdfContentType(contentType);
}

export {
  SURVEY_FILTER_KEYS,
  SURVEY_KAP_FIELDS,
  canonicalizeSurveyAnswer,
  canonicalizeSurveyFieldKey,
  foldText,
  mergeAnswerCounts,
  surveyFieldLabel,
  type SurveyKapFieldDef,
} from "./surveyKap.js";
