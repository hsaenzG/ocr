import {
  canonicalizeSurveyAnswer,
  canonicalizeSurveyFieldKey,
  surveyFieldLabel,
} from "@ocr/shared";
import type {
  DocumentAnalyticsRecord,
  DocumentRepository,
} from "../ports.js";
import { HttpError } from "./presignUploads.js";

export function createUpdateAnalyticsFieldsUseCase(deps: {
  documents: DocumentRepository;
}) {
  return {
    async execute(input: {
      documentId: string;
      fields: Array<{ key: string; value: string; label?: string }>;
    }): Promise<DocumentAnalyticsRecord> {
      if (!input.documentId) {
        throw new HttpError(400, "INVALID_BODY", "documentId is required");
      }
      if (!Array.isArray(input.fields) || input.fields.length === 0) {
        throw new HttpError(
          400,
          "INVALID_BODY",
          "fields must be a non-empty array",
        );
      }

      const normalized = [];
      const seen = new Set<string>();
      for (const field of input.fields) {
        const rawKey = String(field.key ?? "").trim();
        if (!rawKey) continue;
        const key = canonicalizeSurveyFieldKey(rawKey, field.label ?? "");
        const value = canonicalizeSurveyAnswer(
          String(field.value ?? ""),
          key,
        );
        if (!value) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        normalized.push({
          key,
          label: field.label?.trim() || surveyFieldLabel(key) || key,
          value,
          source: "manual" as const,
        });
      }

      if (normalized.length === 0) {
        throw new HttpError(
          400,
          "INVALID_BODY",
          "No valid fields to save after normalization",
        );
      }

      const updated = await deps.documents.updateAnalyticsFields(
        input.documentId,
        normalized,
      );
      if (!updated) {
        throw new HttpError(
          404,
          "NOT_FOUND",
          "Document analytics not found",
        );
      }
      return updated;
    },
  };
}
