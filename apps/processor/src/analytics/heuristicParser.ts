import {
  canonicalizeSurveyAnswer,
  canonicalizeSurveyFieldKey,
  surveyFieldLabel,
  type AnalyticsField,
} from "@ocr/shared";
import {
  buildMetrics,
  detectDocumentKind,
  toTableRows,
  type DocumentAnalyticsParser,
  type ParsedDocumentAnalytics,
} from "./types.js";

/** Deterministic OCR → table fallback when Bedrock is unavailable. */
export function createHeuristicDocumentParser(): DocumentAnalyticsParser {
  return {
    async parse(input): Promise<ParsedDocumentAnalytics> {
      const lines = input.plainText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      const documentKind = detectDocumentKind(input.plainText);
      const fields = extractFields(lines, documentKind);

      return {
        documentKind,
        fields,
        metrics: buildMetrics({
          plainText: input.plainText,
          lineCount: input.lineCount,
          avgConfidence: input.avgConfidence,
          fieldCount: fields.length,
        }),
        tableRows: toTableRows(fields),
        parser: "heuristic",
      };
    },
  };
}

function extractFields(
  lines: string[],
  kind: ReturnType<typeof detectDocumentKind>,
): AnalyticsField[] {
  const fields: AnalyticsField[] = [];
  const seen = new Set<string>();

  const push = (
    key: string,
    label: string,
    value: string,
    source: AnalyticsField["source"],
  ) => {
    const canonicalKey = canonicalizeSurveyFieldKey(key, label);
    const normalizedValue = canonicalizeSurveyAnswer(
      cleanValue(value),
      canonicalKey,
    );
    if (!normalizedValue || normalizedValue.length > 120) {
      return;
    }
    if (seen.has(canonicalKey)) {
      return;
    }
    seen.add(canonicalKey);
    fields.push({
      key: canonicalKey,
      label: surveyFieldLabel(canonicalKey) || label,
      value: normalizedValue,
      source,
    });
  };

  for (const line of lines) {
    const labeled = line.match(/^(.{2,48}?)\s*[:：]\s*(.+)$/u);
    if (labeled) {
      const label = cleanLabel(labeled[1]);
      const value = labeled[2];
      if (label && value && !isNoiseLabel(label)) {
        push(slugify(label), label, value, "label_value");
      }
    }
  }

  if (kind === "survey_kap") {
    const joined = lines.join("\n");
    matchKeyword(joined, /C[oó]digo\s*[:：]?\s*(\d{1,6})/i, (value) =>
      push("codigo", "Código", value, "keyword"),
    );
    matchKeyword(
      joined,
      /Profesi[oó]n\s*[:：]?\s*([A-Za-zÁÉÍÓÚáéíóúñÑ.]{3,40})/i,
      (value) => push("profesion", "Profesión", value, "keyword"),
    );
    matchKeyword(
      joined,
      /(?:gradu[oó]|Hace cu[aá]nto se gradu[oó])\??\s*(\d{1,2})/i,
      (value) =>
        push("anios_graduado", "Años desde graduación", value, "keyword"),
    );
    matchKeyword(
      joined,
      /Edad\s*[:：]?\s*(\d{1,3})\s*(?:a[nñ]os?)?/i,
      (value) => push("edad", "Edad", value, "keyword"),
    );
    if (/G[eé]nero[\s\S]{0,80}Masculino/i.test(joined)) {
      push("genero", "Género", "Masculino", "keyword");
    } else if (/G[eé]nero[\s\S]{0,80}Femenino/i.test(joined)) {
      push("genero", "Género", "Femenino", "keyword");
    }
  }

  if (kind === "invoice" || kind === "receipt") {
    const money = lines
      .map((line) =>
        line.match(
          /(?:total|importe|amount|monto)[^\d$]*([$€]?\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/i,
        ),
      )
      .find(Boolean);
    if (money?.[1]) {
      push("total", "Total", money[1], "keyword");
    }
  }

  return fields.slice(0, 40);
}

function matchKeyword(
  text: string,
  pattern: RegExp,
  onMatch: (value: string) => void,
): void {
  const match = text.match(pattern);
  if (match?.[1]) {
    onMatch(match[1]);
  }
}

function cleanLabel(value: string): string {
  return value
    .replace(/^\d+\.\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanValue(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[|•]+/g, "")
    .trim();
}

function isNoiseLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return (
    lower.length < 2 ||
    /^(si|no|x|of|ns|y)$/i.test(lower) ||
    /^[0-9.\s]+$/.test(lower)
  );
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "campo"
  );
}
