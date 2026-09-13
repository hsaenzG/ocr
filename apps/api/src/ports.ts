export interface Clock {
  nowIso(): string;
}

export interface IdGenerator {
  newId(): string;
}

export interface PresignPutInput {
  key: string;
  contentType: string;
  metadata: Record<string, string>;
  expiresInSeconds: number;
}

export interface ObjectStore {
  createPresignedPut(input: PresignPutInput): Promise<string>;
  createPresignedGet(key: string, expiresInSeconds: number): Promise<string>;
}

export type DocumentStatus =
  | "UPLOADED"
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

export interface DocumentMetaRecord {
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
  /** Epoch seconds — DynamoDB TTL for orphan UPLOADED rows (no S3 PUT). */
  expiresAt?: number;
}

export interface DocumentListQuery {
  status?: DocumentStatus;
  limit: number;
  cursor?: string;
}

export interface DocumentListResult {
  items: Array<{
    documentId: string;
    filename: string;
    status: DocumentStatus;
    contentType: string;
    createdAt: string;
    updatedAt: string;
  }>;
  nextCursor?: string;
}

export interface DocumentAnalyticsRecord {
  documentId: string;
  documentKind: string;
  filename?: string;
  contentType?: string;
  parser?: string;
  fields: Array<{
    key: string;
    label: string;
    value: string;
    source: string;
  }>;
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

export interface DocumentDetail {
  meta: DocumentMetaRecord;
  extract?: {
    documentId: string;
    engine: string;
    mode: string;
    plainText: string;
    lineCount: number;
    avgConfidence: number;
    createdAt: string;
  };
  analytics?: DocumentAnalyticsRecord;
  jobs?: Array<{
    jobId: string;
    documentId: string;
    status: DocumentStatus;
    attempt: number;
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
    errorCode?: string | null;
    errorMessage?: string | null;
  }>;
}

export interface AnalyticsSummary {
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
    label: string;
    values: Array<{ value: string; count: number }>;
  }>;
  kinds: Array<{ kind: string; count: number }>;
}

export interface AnalyticsDocumentItem {
  documentId: string;
  filename: string;
  contentType: string;
  documentKind: string;
  status: DocumentStatus;
  createdAt: string;
  fields: Record<string, string>;
  metrics: {
    lineCount: number;
    wordCount: number;
    avgConfidence: number;
    fieldCount: number;
  };
}

export interface AnalyticsDocumentsResult {
  total: number;
  filters: Record<string, string>;
  items: AnalyticsDocumentItem[];
  fieldBreakdown: Array<{
    key: string;
    label: string;
    values: Array<{ value: string; count: number }>;
  }>;
}

export interface StatsSummary {
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

export interface DocumentRepository {
  putUploadedDocument(meta: DocumentMetaRecord): Promise<void>;
  listDocuments(query: DocumentListQuery): Promise<DocumentListResult>;
  getDocumentDetail(documentId: string): Promise<DocumentDetail | null>;
  updateAnalyticsFields(
    documentId: string,
    fields: Array<{
      key: string;
      label: string;
      value: string;
      source: string;
    }>,
  ): Promise<DocumentAnalyticsRecord | null>;
  getStatsSummary(fromDate: string, toDate: string): Promise<StatsSummary>;
  getAnalyticsSummary(
    fromDate: string,
    toDate: string,
  ): Promise<AnalyticsSummary>;
  queryAnalyticsDocuments(
    filters: Record<string, string>,
  ): Promise<AnalyticsDocumentsResult>;
}
