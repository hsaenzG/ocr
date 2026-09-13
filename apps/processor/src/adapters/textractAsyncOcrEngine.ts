import {
  GetDocumentTextDetectionCommand,
  StartDocumentTextDetectionCommand,
  TextractClient,
  type Block,
} from "@aws-sdk/client-textract";
import type { AsyncOcrEngine, OcrResult } from "../ports.js";

const MAX_RESULT_PAGES = 100;

export function createTextractAsyncOcrEngine(deps: {
  snsTopicArn: string;
  snsRoleArn: string;
  client?: TextractClient;
}): AsyncOcrEngine {
  const textract = deps.client ?? new TextractClient({});

  return {
    async startTextDetection(input): Promise<{ textractJobId: string }> {
      const result = await textract.send(
        new StartDocumentTextDetectionCommand({
          DocumentLocation: {
            S3Object: { Bucket: input.bucket, Name: input.key },
          },
          ClientRequestToken: input.clientRequestToken,
          JobTag: input.jobTag,
          NotificationChannel: {
            SNSTopicArn: deps.snsTopicArn,
            RoleArn: deps.snsRoleArn,
          },
        }),
      );

      if (!result.JobId) {
        throw new Error("Textract did not return a JobId");
      }
      return { textractJobId: result.JobId };
    },

    async fetchTextDetection(textractJobId: string): Promise<OcrResult> {
      const lines: Block[] = [];
      let nextToken: string | undefined;
      let pages = 0;

      do {
        const page = await textract.send(
          new GetDocumentTextDetectionCommand({
            JobId: textractJobId,
            NextToken: nextToken,
          }),
        );

        if (page.JobStatus === "FAILED") {
          throw new Error(
            page.StatusMessage ?? `Textract job ${textractJobId} failed`,
          );
        }

        for (const block of page.Blocks ?? []) {
          if (block.BlockType === "LINE" && block.Text) {
            lines.push(block);
          }
        }

        nextToken = page.NextToken;
        pages += 1;
      } while (nextToken && pages < MAX_RESULT_PAGES);

      return toOcrResult(lines);
    },
  };
}

function toOcrResult(lines: Block[]): OcrResult {
  const plainText = lines.map((line) => line.Text).join("\n");
  const confidences = lines
    .map((line) => line.Confidence)
    .filter((value): value is number => typeof value === "number");
  const avgConfidence =
    confidences.length === 0
      ? 0
      : confidences.reduce((sum, value) => sum + value, 0) / confidences.length;

  return {
    plainText,
    lineCount: lines.length,
    avgConfidence: Number(avgConfidence.toFixed(2)),
    engine: "textract",
    mode: "StartDocumentTextDetection",
  };
}
