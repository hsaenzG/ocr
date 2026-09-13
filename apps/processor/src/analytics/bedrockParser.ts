import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  canonicalizeSurveyAnswer,
  canonicalizeSurveyFieldKey,
  surveyFieldLabel,
  type AnalyticsField,
  type DocumentKind,
} from "@ocr/shared";
import {
  buildMetrics,
  detectDocumentKind,
  toTableRows,
  type DocumentAnalyticsParser,
  type ParsedDocumentAnalytics,
} from "./types.js";

const MAX_CHARS = 14_000;

const SYSTEM_PROMPT = `Eres un extractor de datos estructurados a partir de texto OCR ruidoso.
Devuelve SOLO JSON válido (sin markdown) con esta forma:
{
  "documentKind": "survey_kap" | "invoice" | "receipt" | "generic",
  "fields": [
    { "key": "snake_case", "label": "Etiqueta legible", "value": "valor limpio" }
  ]
}

Reglas:
- Corrige errores OCR obvios (psicologe→psicólogo, Si/Not→Sí/No).
- Para encuestas KAP / MMA usa EXACTAMENTE estas keys canónicas (una por pregunta presente):
  codigo, profesion, anios_graduado, genero, edad, formacion_postgrado, religion,
  entorno_practica, formacion_paliativos, formacion_mma, formacion_aet, formacion_etica,
  educacion_paliativos, educacion_aet, educacion_mma, experiencia_mma,
  preparacion_universidad_mma, fuente_informacion_mma,
  conocimiento_derecho_morir_dignamente, conocimiento_despenalizacion_ams,
  conocimiento_despenalizacion_eutanasia, conocimiento_proceso_eutanasia,
  conocimiento_proceso_ams, conocimiento_ruta_atencion_eutanasia,
  conocimiento_ruta_atencion_ams, conocimiento_rol_salud_mental,
  conocimiento_protocolos_sufrimiento, conocimiento_instrumentos_sufrimiento,
  conocimiento_protocolos_decisiones, conocimiento_instrumentos_decisiones,
  conocimiento_competencias_consentimiento, conocimiento_rol_comite_cientifico,
  conocimiento_dva, conocimiento_tramite_eutanasia, conocimiento_tramite_ams,
  conocimiento_concepto_autonomia, conocimiento_autonomia_individualista,
  conocimiento_sufrimiento_autonomia, conocimiento_autonomia_enfermedad_mental,
  conocimiento_autonomia_capacidad_decidir.
- edad y anios_graduado: solo el número (ej. "32").
- Normaliza Sí/No (nunca "SI", "Not", "NoB").
- Profesión en minúsculas corregida (psicólogo, médico, enfermero, etc.).
- Género: Masculino / Femenino / Otro (capitalización uniforme).
- Escalas de conocimiento: Ningún conocimiento | Conocimiento mínimo | Conocimiento básico | Conocimiento intermedio | Conocimiento avanzado.
- Incluye todas las preguntas respondidas que encuentres (hasta 45 fields).
- Valores cortos y normalizados; no inventes datos que no estén en el texto.
- Si no es encuesta, documentKind invoice/receipt/generic y extrae totales/vendor/fecha cuando existan.`;

export function createBedrockDocumentParser(deps: {
  modelId: string;
  client?: BedrockRuntimeClient;
}): DocumentAnalyticsParser {
  const client = deps.client ?? new BedrockRuntimeClient({});

  return {
    async parse(input): Promise<ParsedDocumentAnalytics> {
      const hintKind = detectDocumentKind(input.plainText);
      const truncated =
        input.plainText.length > MAX_CHARS
          ? `${input.plainText.slice(0, MAX_CHARS)}\n…[truncado]`
          : input.plainText;

      const result = await client.send(
        new ConverseCommand({
          modelId: deps.modelId,
          system: [{ text: SYSTEM_PROMPT }],
          messages: [
            {
              role: "user",
              content: [
                {
                  text: `Hint documentKind=${hintKind}\n\nOCR plainText:\n${truncated}`,
                },
              ],
            },
          ],
          inferenceConfig: {
            maxTokens: 4096,
            temperature: 0,
          },
        }),
      );

      const rawText =
        result.output?.message?.content
          ?.map((block) => ("text" in block ? block.text : ""))
          .join("\n")
          .trim() ?? "";

      const parsedJson = parseJsonObject(rawText);
      const fields = normalizeFields(parsedJson?.fields);
      const documentKind = normalizeKind(
        parsedJson?.documentKind,
        hintKind,
      );

      if (fields.length === 0) {
        throw new Error("Bedrock returned no usable fields");
      }

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
        parser: "bedrock",
      };
    },
  };
}

export function createDocumentAnalyticsParser(deps: {
  primary?: DocumentAnalyticsParser;
  fallback: DocumentAnalyticsParser;
}): DocumentAnalyticsParser {
  return {
    async parse(input): Promise<ParsedDocumentAnalytics> {
      if (!deps.primary) {
        return deps.fallback.parse(input);
      }
      try {
        return await deps.primary.parse(input);
      } catch (error) {
        console.warn("Primary analytics parser failed; using fallback", {
          error: error instanceof Error ? error.message : error,
        });
        return deps.fallback.parse(input);
      }
    },
  };
}

function parseJsonObject(raw: string): {
  documentKind?: string;
  fields?: unknown;
} | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as {
      documentKind?: string;
      fields?: unknown;
    };
  } catch {
    return null;
  }
}

function normalizeKind(
  value: unknown,
  fallback: DocumentKind,
): DocumentKind {
  if (
    value === "survey_kap" ||
    value === "invoice" ||
    value === "receipt" ||
    value === "generic"
  ) {
    return value;
  }
  return fallback;
}

function normalizeFields(value: unknown): AnalyticsField[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const fields: AnalyticsField[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const rawKey = slugify(String(record.key ?? record.label ?? ""));
    const rawLabel = String(record.label ?? record.key ?? rawKey).trim();
    const rawValue = String(record.value ?? "").replace(/\s+/g, " ").trim();
    if (!rawKey || !rawLabel || !rawValue || rawValue.length > 160) continue;

    const key = canonicalizeSurveyFieldKey(rawKey, rawLabel);
    const label = surveyFieldLabel(key) || rawLabel.slice(0, 80);
    const fieldValue = canonicalizeSurveyAnswer(rawValue, key);
    if (!fieldValue) continue;

    if (seen.has(key)) continue;
    seen.add(key);
    fields.push({
      key,
      label,
      value: fieldValue,
      source: "bedrock",
    });
  }

  return fields.slice(0, 45);
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || ""
  );
}
