export interface S3ObjectCreatedRef {
  bucket: string;
  key: string;
}

interface S3EventRecord {
  s3?: {
    bucket?: { name?: string };
    object?: { key?: string };
  };
}

export function parseS3ObjectCreatedFromSqsBody(
  body: string,
): S3ObjectCreatedRef[] {
  const parsed = JSON.parse(body) as {
    Records?: S3EventRecord[];
    Message?: string;
  };

  // Direct S3 → SQS notification
  if (Array.isArray(parsed.Records)) {
    return mapRecords(parsed.Records);
  }

  // Rare: SNS-wrapped (not used in this stack, but safe)
  if (typeof parsed.Message === "string") {
    const inner = JSON.parse(parsed.Message) as { Records?: S3EventRecord[] };
    return mapRecords(inner.Records ?? []);
  }

  return [];
}

function mapRecords(records: S3EventRecord[]): S3ObjectCreatedRef[] {
  const refs: S3ObjectCreatedRef[] = [];
  for (const record of records) {
    const bucket = record.s3?.bucket?.name;
    const rawKey = record.s3?.object?.key;
    if (!bucket || !rawKey) {
      continue;
    }
    refs.push({
      bucket,
      key: decodeS3Key(rawKey),
    });
  }
  return refs;
}

function decodeS3Key(key: string): string {
  return decodeURIComponent(key.replace(/\+/g, " "));
}
