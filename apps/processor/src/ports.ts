export type DocumentStatus =
  | "UPLOADED"
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

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
}

export interface OcrResult {
  plainText: string;
  lineCount: number;
  avgConfidence: number;
  engine: string;
  mode: string;
}

export interface ObjectMetadata {
  contentType?: string;
  documentId?: string;
  originalFilename?: string;
}

export interface Clock {
  nowIso(): string;
}

export interface IdGenerator {
  newId(): string;
}

export interface ObjectReader {
  getObjectMetadata(bucket: string, key: string): Promise<ObjectMetadata>;
}

export interface OcrEngine {
  extractText(bucket: string, key: string): Promise<OcrResult>;
}

export interface DocumentStore {
  getMetaByS3Key(bucket: string, key: string): Promise<DocumentMeta | null>;
  getMeta(documentId: string): Promise<DocumentMeta | null>;
  markProcessing(documentId: string, jobId: string, startedAt: string): Promise<void>;
  markCompleted(input: {
    documentId: string;
    jobId: string;
    extract: OcrResult;
    startedAt: string;
    endedAt: string;
  }): Promise<void>;
  markFailed(input: {
    documentId: string;
    jobId: string;
    startedAt: string;
    endedAt: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
}
