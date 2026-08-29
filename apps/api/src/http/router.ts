import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type {
  Clock,
  DocumentRepository,
  DocumentStatus,
  IdGenerator,
  ObjectStore,
} from "../ports.js";
import { errorResponse, jsonResponse, optionsResponse } from "./response.js";
import {
  createPresignUploadsUseCase,
  HttpError,
} from "../useCases/presignUploads.js";

export function createApiRouter(deps: {
  documents: DocumentRepository;
  objectStore: ObjectStore;
  clock: Clock;
  ids: IdGenerator;
  uploadPrefix: string;
  maxUploadBytes: number;
  docsBucketName: string;
}) {
  const presignUploads = createPresignUploadsUseCase(deps);

  return {
    async handle(event: APIGatewayProxyEventV2) {
      const method = event.requestContext.http.method.toUpperCase();
      const path = normalizePath(event.rawPath);

      if (method === "OPTIONS") {
        return optionsResponse();
      }

      try {
        if (method === "GET" && path === "/health") {
          return jsonResponse(200, { ok: true, service: "ocr-api" });
        }

        if (method === "POST" && path === "/uploads/presign") {
          const body = parseJsonBody(event.body);
          const files = Array.isArray(body.files) ? body.files : [];
          const result = await presignUploads.execute(files);
          return jsonResponse(200, result);
        }

        if (method === "GET" && path === "/documents") {
          const status = event.queryStringParameters?.status as
            | DocumentStatus
            | undefined;
          const limit = clampLimit(event.queryStringParameters?.limit);
          const cursor = event.queryStringParameters?.cursor;
          const result = await deps.documents.listDocuments({
            status,
            limit,
            cursor,
          });
          return jsonResponse(200, result);
        }

        const documentMatch = path.match(/^\/documents\/([^/]+)$/);
        if (method === "GET" && documentMatch) {
          const documentId = decodeURIComponent(documentMatch[1]);
          const detail = await deps.documents.getDocumentDetail(documentId);
          if (!detail) {
            return errorResponse(404, "NotFound", "Document not found", "NOT_FOUND");
          }
          return jsonResponse(200, detail);
        }

        const previewMatch = path.match(/^\/documents\/([^/]+)\/preview-url$/);
        if (method === "GET" && previewMatch) {
          const documentId = decodeURIComponent(previewMatch[1]);
          const detail = await deps.documents.getDocumentDetail(documentId);
          if (!detail) {
            return errorResponse(404, "NotFound", "Document not found", "NOT_FOUND");
          }
          const expiresIn = 300;
          const url = await deps.objectStore.createPresignedGet(
            detail.meta.s3Key,
            expiresIn,
          );
          return jsonResponse(200, { url, expiresIn });
        }

        if (method === "GET" && path === "/stats/summary") {
          const toDate =
            event.queryStringParameters?.to ?? deps.clock.nowIso().slice(0, 10);
          const fromDate =
            event.queryStringParameters?.from ?? shiftDays(toDate, -13);
          const summary = await deps.documents.getStatsSummary(fromDate, toDate);
          return jsonResponse(200, summary);
        }

        return errorResponse(404, "NotFound", `No route for ${method} ${path}`, "NOT_FOUND");
      } catch (error) {
        if (error instanceof HttpError) {
          return errorResponse(
            error.statusCode,
            "RequestError",
            error.message,
            error.code,
          );
        }
        console.error("Unhandled API error", error);
        return errorResponse(
          500,
          "InternalError",
          "Unexpected server error",
          "INTERNAL",
        );
      }
    },
  };
}

function normalizePath(rawPath: string): string {
  if (!rawPath) {
    return "/";
  }
  const trimmed = rawPath.replace(/\/+$/, "");
  return trimmed.length === 0 ? "/" : trimmed;
}

function parseJsonBody(body: string | undefined): Record<string, unknown> {
  if (!body) {
    return {};
  }
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

function clampLimit(raw: string | undefined): number {
  const parsed = Number(raw ?? 25);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 25;
  }
  return Math.min(Math.floor(parsed), 100);
}

function shiftDays(isoDate: string, deltaDays: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}
