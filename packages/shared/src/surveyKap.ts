/**
 * Canonical KAP / MMA survey schema (based on a well-formed questionnaire).
 * Used to unify OCR/Bedrock field keys and answer casing across documents.
 */

export interface SurveyKapFieldDef {
  key: string;
  label: string;
  /** Substrings matched against key+label (folded) to map synonyms. */
  matchers: string[];
}

export const SURVEY_KAP_FIELDS: SurveyKapFieldDef[] = [
  { key: "codigo", label: "Código", matchers: ["codigo", "código"] },
  { key: "profesion", label: "Profesión", matchers: ["profesion", "profesión"] },
  {
    key: "anios_graduado",
    label: "Años desde graduación",
    matchers: ["anios_graduado", "años desde", "gradu"],
  },
  {
    key: "formacion_postgrado",
    label: "Formación postgrado",
    matchers: ["formacion_postgrado", "postgrado"],
  },
  {
    key: "entorno_practica",
    label: "Entorno de práctica",
    matchers: ["entorno_practica", "entorno de practica", "práctica profesional"],
  },
  { key: "genero", label: "Género", matchers: ["genero", "género"] },
  { key: "edad", label: "Edad", matchers: ["edad"] },
  { key: "religion", label: "Religión", matchers: ["religion", "religión"] },
  {
    key: "formacion_paliativos",
    label: "Formación cuidados paliativos",
    matchers: ["formacion_paliativos", "formacion en cuidados paliativos"],
  },
  {
    key: "formacion_mma",
    label: "Formación MMA",
    matchers: ["formacion_mma", "formacion en muerte medicamente"],
  },
  {
    key: "formacion_aet",
    label: "Formación AET",
    matchers: ["formacion_aet", "adecuacion del esfuerzo", "adecuación del esfuerzo"],
  },
  {
    key: "formacion_etica",
    label: "Formación ética / bioética",
    matchers: ["formacion_etica", "etica medica", "bioetica", "bioderecho"],
  },
  {
    key: "educacion_paliativos",
    label: "Calificación educación paliativos",
    matchers: [
      "educacion_paliativos",
      "calificacion_educacion_paliativos",
      "educacion_cuidados_paliativos",
      "calificaria la educacion recibida.*paliativ",
    ],
  },
  {
    key: "educacion_aet",
    label: "Calificación educación AET",
    matchers: ["educacion_aet", "calificacion_educacion_aet"],
  },
  {
    key: "educacion_mma",
    label: "Calificación educación MMA",
    matchers: ["educacion_mma", "calificacion_educacion_mma"],
  },
  {
    key: "experiencia_mma",
    label: "Experiencia atención MMA",
    matchers: ["experiencia_mma", "experiencia_atencion_mma", "experiencia en atencion"],
  },
  {
    key: "preparacion_universidad_mma",
    label: "Preparación universidad MMA",
    matchers: [
      "preparacion_universidad_mma",
      "preparacion_mma",
      "universidad lo prepar",
      "universidad la prepar",
    ],
  },
  {
    key: "fuente_informacion_mma",
    label: "Fuente de información MMA",
    matchers: ["fuente_informacion_mma", "fuente de informacion", "principal fuente"],
  },
  {
    key: "conocimiento_derecho_morir_dignamente",
    label: "Conocimiento: derecho a morir dignamente",
    matchers: [
      "conocimiento_derecho_morir",
      "conocimiento_eutanasia",
      "derecho a morir",
      "morir dignamente",
    ],
  },
  {
    key: "conocimiento_despenalizacion_ams",
    label: "Conocimiento: despenalización AMS",
    matchers: [
      "conocimiento_despenalizacion_ams",
      "despenalizacion de la ams",
      "despenalizacion ams",
    ],
  },
  {
    key: "conocimiento_despenalizacion_eutanasia",
    label: "Conocimiento: despenalización eutanasia",
    matchers: [
      "conocimiento_despenalizacion_eutanasia",
      "despenalizacion de la eutanasia",
      "despenalizacion eutanasia",
    ],
  },
  {
    key: "conocimiento_proceso_eutanasia",
    label: "Conocimiento: proceso eutanasia",
    matchers: [
      "conocimiento_proceso_eutanasia",
      "proceso_practica_eutanasia",
      "proceso para la practica de la eutanasia",
    ],
  },
  {
    key: "conocimiento_proceso_ams",
    label: "Conocimiento: proceso AMS",
    matchers: [
      "conocimiento_proceso_ams",
      "proceso_practica_ams",
      "proceso para la practica de la asistencia medica",
    ],
  },
  {
    key: "conocimiento_ruta_atencion_eutanasia",
    label: "Conocimiento: ruta atención eutanasia",
    matchers: [
      "conocimiento_ruta_atencion_eutanasia",
      "ruta_atencion_eutanasia",
      "ruta de atencion para la eutanasia",
    ],
  },
  {
    key: "conocimiento_ruta_atencion_ams",
    label: "Conocimiento: ruta atención AMS",
    matchers: [
      "conocimiento_ruta_atencion_ams",
      "ruta_atencion_ams",
      "ruta de atencion para la asistencia",
    ],
  },
  {
    key: "conocimiento_rol_salud_mental",
    label: "Conocimiento: rol salud mental en MMA",
    matchers: [
      "conocimiento_rol_salud_mental",
      "conocimiento_rol_profesional_salud_mental",
      "rol_profesional_salud_mental_mma",
      "rol del profesional de la salud mental para el acceso",
    ],
  },
  {
    key: "conocimiento_protocolos_sufrimiento",
    label: "Conocimiento: protocolos evaluar sufrimiento",
    matchers: [
      "conocimiento_protocolos_sufrimiento",
      "conocimiento_protocolos_evaluacion_sufrimiento",
      "conocimiento_protocolos_evaluar_sufrimiento",
      "protocolos_evaluar_sufrimiento",
      "protocolos para evaluar el sufrimiento",
    ],
  },
  {
    key: "conocimiento_instrumentos_sufrimiento",
    label: "Conocimiento: instrumentos evaluar sufrimiento",
    matchers: [
      "conocimiento_instrumentos_sufrimiento",
      "conocimiento_instrumentos_evaluacion_sufrimiento",
      "conocimiento_instrumentos_evaluar_sufrimiento",
      "instrumentos_evaluar_sufrimiento",
      "instrumentos para evaluar el sufrimiento",
    ],
  },
  {
    key: "conocimiento_protocolos_decisiones",
    label: "Conocimiento: protocolos capacidad decisión",
    matchers: [
      "conocimiento_protocolos_decisiones",
      "conocimiento_protocolos_evaluacion_capacidad",
      "conocimiento_protocolos_evaluar_capacidad",
      "protocolos_evaluar_capacidad",
      "protocolos para evaluar la capacidad",
    ],
  },
  {
    key: "conocimiento_instrumentos_decisiones",
    label: "Conocimiento: instrumentos capacidad decisión",
    matchers: [
      "conocimiento_instrumentos_decisiones",
      "conocimiento_instrumentos_evaluacion_capacidad",
      "conocimiento_instrumentos_evaluar_capacidad",
      "instrumentos_evaluar_capacidad",
      "instrumentos para evaluar la capacidad",
    ],
  },
  {
    key: "conocimiento_competencias_consentimiento",
    label: "Conocimiento: competencias mentales / consentimiento",
    matchers: [
      "conocimiento_competencias_consentimiento",
      "conocimiento_competencias_mentales",
      "competencias_mentales_consentimiento",
      "competencias mentales",
    ],
  },
  {
    key: "conocimiento_rol_comite_cientifico",
    label: "Conocimiento: rol en comité científico",
    matchers: [
      "conocimiento_rol_comite_cientifico",
      "conocimiento_rol_salud_mental_comite",
      "conocimiento_rol_profesional_salud_mental_comite",
      "rol_profesional_salud_mental_comite",
      "comite cientifico",
      "comité científico",
    ],
  },
  {
    key: "conocimiento_dva",
    label: "Conocimiento: regulación DVA",
    matchers: [
      "conocimiento_dva",
      "conocimiento_regulacion_dva",
      "regulacion_voluntades_anticipadas",
      "voluntades anticipadas",
      "regulacion sobre las voluntades",
    ],
  },
  {
    key: "conocimiento_tramite_eutanasia",
    label: "Conocimiento: trámite solicitud eutanasia/DVA",
    matchers: [
      "conocimiento_tramite_eutanasia",
      "conocimiento_tramite_solicitud_eutanasia",
      "tramite_solicitud_eutanasia",
      "tramite para gestionar una solicitud",
    ],
  },
  {
    key: "conocimiento_tramite_ams",
    label: "Conocimiento: trámite AMS / apoyos interpretativos",
    matchers: [
      "conocimiento_tramite_ams",
      "conocimiento_tramite_solicitud_ams",
      "conocimiento_apoyo_interpretativos",
      "tramite_solicitud_eutanasia_ams",
      "apoyos interpretativos",
    ],
  },
  {
    key: "conocimiento_concepto_autonomia",
    label: "Conocimiento: concepto de autonomía",
    matchers: [
      "conocimiento_concepto_autonomia",
      "conocimiento_aspectos_concepto_autonomia",
      "conocimiento_aspectos_teoricos_autonomia",
      "aspectos teoricos",
      "concepto de autonomia",
    ],
  },
  {
    key: "conocimiento_autonomia_individualista",
    label: "Conocimiento: autonomía individualista vs relacional",
    matchers: [
      "conocimiento_autonomia_individualista",
      "conocimiento_distincion_autonomia_individualista",
      "autonomia individualista",
    ],
  },
  {
    key: "conocimiento_sufrimiento_autonomia",
    label: "Conocimiento: sufrimiento y autonomía",
    matchers: [
      "conocimiento_sufrimiento_autonomia",
      "conocimiento_relacion_sufrimiento_autonomia",
      "sufrimiento con la autonomia",
    ],
  },
  {
    key: "conocimiento_autonomia_enfermedad_mental",
    label: "Conocimiento: autonomía y enfermedad mental",
    matchers: [
      "conocimiento_autonomia_enfermedad_mental",
      "conocimiento_nocion_autonomia",
      "nocion de autonomia",
      "paciente con enfermedad mental",
    ],
  },
  {
    key: "conocimiento_autonomia_capacidad_decidir",
    label: "Conocimiento: autonomía y capacidad de decidir",
    matchers: [
      "conocimiento_autonomia_capacidad_decidir",
      "conocimiento_relacion_autonomia_capacidad",
      "capacidad de decidir",
    ],
  },
];

/** Demographic / filterable subset for dashboard filters. */
export const SURVEY_FILTER_KEYS = [
  "codigo",
  "profesion",
  "genero",
  "edad",
  "anios_graduado",
  "formacion_postgrado",
  "religion",
  "entorno_practica",
  "formacion_paliativos",
  "formacion_mma",
  "formacion_aet",
  "formacion_etica",
] as const;

export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function surveyFieldLabel(key: string): string {
  return SURVEY_KAP_FIELDS.find((field) => field.key === key)?.label ?? key;
}

/**
 * Map OCR/Bedrock key+label to a stable survey key when possible.
 */
export function canonicalizeSurveyFieldKey(
  key: string,
  label = "",
): string {
  const rawKey = foldText(key).replace(/\s+/g, "_");
  if (SURVEY_KAP_FIELDS.some((field) => field.key === rawKey)) {
    return rawKey;
  }

  const blob = foldText(`${key} ${label}`);
  if (!blob) return key;

  let best: { key: string; score: number } | null = null;
  for (const field of SURVEY_KAP_FIELDS) {
    for (const matcher of field.matchers) {
      const m = foldText(matcher);
      if (!m) continue;

      let matched = false;
      if (m.includes(".*")) {
        matched = new RegExp(m).test(blob);
      } else {
        matched =
          blob === m ||
          rawKey === m ||
          rawKey.startsWith(`${m}_`) ||
          rawKey.endsWith(`_${m}`) ||
          blob.includes(m);
      }
      if (!matched) continue;

      const score = m.replace(".*", "").length;
      if (m.length <= 4 && rawKey !== m && !new RegExp(`(^|_)${m}(_|$)`).test(rawKey)) {
        continue;
      }
      if (
        field.key === "conocimiento_despenalizacion_ams" &&
        blob.includes("eutanasia") &&
        !/\bams\b|_ams/.test(blob)
      ) {
        continue;
      }
      if (
        field.key === "conocimiento_despenalizacion_eutanasia" &&
        /\bams\b|_ams/.test(blob) &&
        !blob.includes("eutanasia")
      ) {
        continue;
      }
      if (field.key === "educacion_paliativos") {
        if (!/paliativ/.test(blob)) continue;
        if (
          /formacion_paliativos|tiene.*paliativ/.test(blob) &&
          !/calific|educacion_/.test(blob)
        ) {
          continue;
        }
      }
      if (
        field.key.startsWith("formacion_") &&
        /calific|educacion_paliativos|educacion_aet|educacion_mma|como calific/.test(
          blob,
        )
      ) {
        continue;
      }
      if (!best || score > best.score) {
        best = { key: field.key, score };
      }
    }
  }

  return best?.key ?? key;
}

/**
 * Unify answers that only differ by casing / accents / trivial OCR noise.
 */
export function canonicalizeSurveyAnswer(
  value: string,
  fieldKey?: string,
): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return trimmed;

  if (/^(si|sí)$/i.test(trimmed)) return "Sí";
  if (/^(no|not|nob)$/i.test(trimmed)) return "No";

  const folded = foldText(trimmed);

  if (fieldKey === "edad" || fieldKey === "anios_graduado" || fieldKey === "codigo") {
    const digits = trimmed.match(/\d+/);
    if (digits) return digits[0];
    if (fieldKey === "edad" || fieldKey === "anios_graduado") return "";
  }

  if (fieldKey === "genero") {
    if (folded.startsWith("masc") || folded === "hombre") return "Masculino";
    if (folded.startsWith("fem") || folded === "mujer") return "Femenino";
    if (folded.startsWith("otro") || folded.includes("no bin")) return "Otro";
  }

  if (fieldKey === "profesion") {
    const professions: Record<string, string> = {
      psicologo: "psicólogo",
      psicologa: "psicólogo",
      psicologia: "psicólogo",
      psicologica: "psicólogo",
      psicologico: "psicólogo",
      medico: "médico",
      medica: "médico",
      enfermero: "enfermero",
      enfermera: "enfermero",
      psiquiatra: "psiquiatra",
      psiquiatrico: "psiquiatra",
      psiquiatrica: "psiquiatra",
      "trabajador social": "trabajador social",
      "trabajadora social": "trabajador social",
    };
    if (professions[folded]) return professions[folded];
    // Drop garbage like "ales" from bad OCR of "profesionales"
    if (folded === "ales" || folded.length < 3) return trimmed;
    return folded;
  }

  const knowledgeLevels: Array<[string, string]> = [
    ["ningun conocimiento", "Ningún conocimiento"],
    ["conocimiento minimo", "Conocimiento mínimo"],
    ["conocimiento basico", "Conocimiento básico"],
    ["conocimiento intermedio", "Conocimiento intermedio"],
    ["conocimiento avanzado", "Conocimiento avanzado"],
  ];
  for (const [pattern, display] of knowledgeLevels) {
    if (folded === pattern) return display;
  }

  const ratings: Array<[string, string]> = [
    ["excelente", "Excelente"],
    ["buena", "Buena"],
    ["regular", "Regular"],
    ["mala", "Mala"],
    ["no he recibido educacion en el tema", "No he recibido educación en el tema"],
    ["ninguna", "Ninguna"],
    ["entre 1 y 2", "Entre 1 y 2"],
    ["entre 3 y 4", "Entre 3 y 4"],
    ["entre 5 y 6", "Entre 5 y 6"],
    ["mas de 6", "Más de 6"],
    ["catolico", "Católico"],
    ["cristiano", "Cristiano"],
    ["consulta externa", "Consulta externa"],
    ["urgencias", "Urgencias"],
    ["hospitalizacion", "Hospitalización"],
    ["subespecialista organizacional", "Subespecialista organizacional"],
    ["subespecialista", "Subespecialista"],
  ];
  for (const [pattern, display] of ratings) {
    if (folded === pattern) return display;
  }

  // Case-only variants → sentence case preserving content
  if (trimmed === trimmed.toUpperCase() && trimmed.length > 1) {
    return trimmed.charAt(0) + trimmed.slice(1).toLowerCase();
  }
  if (trimmed === trimmed.toLowerCase() && /[a-záéíóúñ]/.test(trimmed)) {
    // Keep professions lower; otherwise capitalize first letter for short answers
    if (fieldKey === "profesion") return trimmed;
    if (trimmed.length <= 40) {
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }
  }

  return trimmed;
}

/** Aggregate values merging case/accent-insensitive duplicates. */
export function mergeAnswerCounts(
  values: Iterable<string>,
  fieldKey?: string,
): Array<{ value: string; count: number }> {
  const map = new Map<string, { value: string; count: number }>();
  for (const raw of values) {
    const canonical = canonicalizeSurveyAnswer(raw, fieldKey);
    if (!canonical) continue;
    const fold = foldText(canonical);
    const existing = map.get(fold);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(fold, { value: canonical, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
