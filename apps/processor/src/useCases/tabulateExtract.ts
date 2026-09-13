import type { AnalyticsStore } from "../adapters/dynamoAnalyticsStore.js";
import type { DocumentAnalyticsParser } from "../analytics/types.js";

export function createTabulateExtractUseCase(deps: {
  analytics: AnalyticsStore;
  parser: DocumentAnalyticsParser;
}) {
  return {
    async execute(input: {
      documentId: string;
      plainText: string;
      lineCount: number;
      avgConfidence: number;
      createdAt: string;
      filename?: string;
      contentType?: string;
      force?: boolean;
    }): Promise<void> {
      const meta =
        input.filename && input.contentType
          ? {
              filename: input.filename,
              contentType: input.contentType,
            }
          : await deps.analytics.getMetaBasics(input.documentId);

      const parsed = await deps.parser.parse({
        plainText: input.plainText,
        lineCount: input.lineCount,
        avgConfidence: input.avgConfidence,
      });

      await deps.analytics.putDocumentAnalytics({
        documentId: input.documentId,
        filename: meta?.filename ?? input.filename,
        contentType: meta?.contentType ?? input.contentType,
        parsed,
        createdAt: input.createdAt,
        force: input.force,
      });

      console.log("Tabulated extract analytics", {
        documentId: input.documentId,
        documentKind: parsed.documentKind,
        fieldCount: parsed.fields.length,
        parser: parsed.parser,
      });
    },
  };
}
