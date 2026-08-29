import {
  DetectDocumentTextCommand,
  TextractClient,
  type Block,
} from "@aws-sdk/client-textract";
import type { OcrEngine, OcrResult } from "../ports.js";

export function createTextractOcrEngine(client?: TextractClient): OcrEngine {
  const textract = client ?? new TextractClient({});
  return {
    async extractText(bucket: string, key: string): Promise<OcrResult> {
      const result = await textract.send(
        new DetectDocumentTextCommand({
          Document: {
            S3Object: {
              Bucket: bucket,
              Name: key,
            },
          },
        }),
      );

      const lines = (result.Blocks ?? []).filter(
        (block): block is Block => block.BlockType === "LINE" && !!block.Text,
      );
      const plainText = lines.map((line) => line.Text).join("\n");
      const confidences = lines
        .map((line) => line.Confidence)
        .filter((value): value is number => typeof value === "number");
      const avgConfidence =
        confidences.length === 0
          ? 0
          : confidences.reduce((sum, value) => sum + value, 0) /
            confidences.length;

      return {
        plainText,
        lineCount: lines.length,
        avgConfidence: Number(avgConfidence.toFixed(2)),
        engine: "textract",
        mode: "DetectDocumentText",
      };
    },
  };
}
