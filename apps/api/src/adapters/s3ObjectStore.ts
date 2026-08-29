import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStore, PresignPutInput } from "../ports.js";

export function createObjectStore(deps: {
  bucketName: string;
  client?: S3Client;
}): ObjectStore {
  // Disable flexible checksums on presigned PUTs — browsers don't send
  // x-amz-checksum-* matching the empty CRC32 the SDK would bake into the URL.
  const client =
    deps.client ??
    new S3Client({
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  const bucket = deps.bucketName;

  return {
    async createPresignedPut(input: PresignPutInput): Promise<string> {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: input.key,
        ContentType: input.contentType,
        Metadata: input.metadata,
      });
      return getSignedUrl(client, command, {
        expiresIn: input.expiresInSeconds,
        signableHeaders: new Set(["content-type"]),
      });
    },

    async createPresignedGet(
      key: string,
      expiresInSeconds: number,
    ): Promise<string> {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });
      return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
    },
  };
}
