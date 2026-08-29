const apiBaseUrl = (import.meta.env.PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiBaseUrl) {
    throw new ApiClientError(
      0,
      "MISSING_API_BASE",
      "Set PUBLIC_API_BASE_URL to your API Gateway URL",
    );
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let code = "HTTP_ERROR";
    let message = response.statusText;
    try {
      const body = (await response.json()) as {
        code?: string;
        message?: string;
      };
      code = body.code ?? code;
      message = body.message ?? message;
    } catch {
      // ignore
    }
    throw new ApiClientError(response.status, code, message);
  }

  return (await response.json()) as T;
}

export const api = {
  health: () => request<{ ok: boolean }>("/health"),
  presign: (files: Array<{ filename: string; contentType: string; sizeBytes: number }>) =>
    request<{
      uploads: Array<{
        documentId: string;
        s3Key: string;
        uploadUrl: string;
        headers: Record<string, string>;
      }>;
    }>("/uploads/presign", {
      method: "POST",
      body: JSON.stringify({ files }),
    }),
  listDocuments: (params?: { status?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.limit) query.set("limit", String(params.limit));
    const suffix = query.toString() ? `?${query}` : "";
    return request<{
      items: Array<{
        documentId: string;
        filename: string;
        status: string;
        contentType: string;
        createdAt: string;
        updatedAt: string;
      }>;
    }>(`/documents${suffix}`);
  },
  getDocument: (documentId: string) =>
    request<{
      meta: {
        documentId: string;
        filename: string;
        status: string;
        contentType: string;
        sizeBytes: number;
        s3Key: string;
        createdAt: string;
        updatedAt: string;
        completedAt?: string;
        errorMessage?: string | null;
      };
      extract?: {
        plainText: string;
        lineCount: number;
        avgConfidence: number;
        engine: string;
        mode: string;
      };
      jobs?: Array<{
        jobId: string;
        status: string;
        attempt: number;
        errorMessage?: string | null;
      }>;
    }>(`/documents/${documentId}`),
  previewUrl: (documentId: string) =>
    request<{ url: string; expiresIn: number }>(
      `/documents/${documentId}/preview-url`,
    ),
  statsSummary: (from?: string, to?: string) => {
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    const suffix = query.toString() ? `?${query}` : "";
    return request<{
      totals: {
        uploaded: number;
        completed: number;
        failed: number;
        processing: number;
      };
      series: Array<{
        date: string;
        uploaded: number;
        completed: number;
        failed: number;
        processing: number;
      }>;
    }>(`/stats/summary${suffix}`);
  },
};

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}
