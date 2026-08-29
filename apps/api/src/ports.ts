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
  getStatsSummary(fromDate: string, toDate: string): Promise<StatsSummary>;
}
