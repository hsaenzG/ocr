import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ObjectReader } from "../ports.js";

export function createS3ObjectReader(client?: S3Client): ObjectReader {
  const s3 = client ?? new S3Client({});
  return {
    async getObjectMetadata(bucket: string, key: string) {
      const result = await s3.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      const metadata = result.Metadata ?? {};
      return {
        contentType: result.ContentType,
        documentId: metadata["document-id"] ?? metadata.documentid,
        originalFilename:
          metadata["original-filename"] ?? metadata.originalfilename,
      };
    },
  };
}
