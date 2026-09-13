import type { AnalyticsField, DocumentKind } from "@ocr/shared";

export interface ParsedDocumentAnalytics {
  documentKind: DocumentKind;
  fields: AnalyticsField[];
  metrics: {
    lineCount: number;
    wordCount: number;
    charCount: number;
    avgConfidence: number;
    fieldCount: number;
  };
  tableRows: Array<{ key: string; value: string }>;
  parser: "heuristic" | "bedrock";
}

export interface DocumentAnalyticsParser {
  parse(input: {
    plainText: string;
    lineCount: number;
    avgConfidence: number;
  }): Promise<ParsedDocumentAnalytics>;
}

export function buildMetrics(input: {
  plainText: string;
  lineCount: number;
  avgConfidence: number;
  fieldCount: number;
}): ParsedDocumentAnalytics["metrics"] {
  const lines = input.plainText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const words = input.plainText.match(/[\p{L}\p{N}]+/gu) ?? [];
  return {
    lineCount: input.lineCount || lines.length,
    wordCount: words.length,
    charCount: input.plainText.length,
    avgConfidence: Number(input.avgConfidence.toFixed(2)),
    fieldCount: input.fieldCount,
  };
}

export function toTableRows(
  fields: AnalyticsField[],
): Array<{ key: string; value: string }> {
  return fields.map((field) => ({
    key: field.label,
    value: field.value,
  }));
}

export function detectDocumentKind(text: string): DocumentKind {
  const lower = text.toLowerCase();
  if (
    lower.includes("encuesta") ||
    lower.includes("muerte medicamente asistida") ||
    lower.includes("kap")
  ) {
    return "survey_kap";
  }
  if (
    lower.includes("factura") ||
    lower.includes("invoice") ||
    lower.includes("rfc") ||
    lower.includes("subtotal")
  ) {
    return "invoice";
  }
  if (
    lower.includes("recibo") ||
    lower.includes("receipt") ||
    lower.includes("ticket")
  ) {
    return "receipt";
  }
  return "generic";
}
