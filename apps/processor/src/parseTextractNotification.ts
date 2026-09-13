export interface TextractNotification {
  textractJobId: string;
  status: "SUCCEEDED" | "FAILED" | "PARTIAL_SUCCESS";
  statusMessage?: string;
}

/**
 * Textract publishes to SNS, SNS delivers to SQS, so the payload can be the
 * notification itself (raw delivery) or wrapped in an SNS envelope.
 */
export function parseTextractNotificationFromSqsBody(
  body: string,
): TextractNotification | null {
  const outer = safeJsonParse(body);
  if (!isRecord(outer)) {
    return null;
  }

  const payload =
    typeof outer.Message === "string"
      ? safeJsonParse(outer.Message)
      : outer;

  if (!isRecord(payload)) {
    return null;
  }

  const textractJobId = payload.JobId;
  const status = payload.Status;
  if (typeof textractJobId !== "string" || typeof status !== "string") {
    return null;
  }

  return {
    textractJobId,
    status: status as TextractNotification["status"],
    statusMessage:
      typeof payload.StatusMessage === "string"
        ? payload.StatusMessage
        : undefined,
  };
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
