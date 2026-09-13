import { clearAuthSession, getAuthToken } from "./auth";

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

async function request<T>(
  path: string,
  init?: RequestInit,
  options?: { auth?: boolean },
): Promise<T> {
  if (!apiBaseUrl) {
    throw new ApiClientError(
      0,
      "MISSING_API_BASE",
      "Set PUBLIC_API_BASE_URL to your API Gateway URL",
    );
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };

  if (options?.auth !== false) {
    const token = getAuthToken();
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
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

    if (response.status === 401 && options?.auth !== false) {
      clearAuthSession();
      if (!window.location.pathname.startsWith("/login")) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.href = `/login/?next=${encodeURIComponent(next)}`;
      }
    }

    throw new ApiClientError(response.status, code, message);
  }

  return (await response.json()) as T;
}

export const api = {
  health: () => request<{ ok: boolean }>("/health", undefined, { auth: false }),
  login: (username: string, password: string) =>
    request<{
      username: string;
      token: string;
      expiresAt: string;
    }>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ username, password }),
      },
      { auth: false },
    ),
  me: () => request<{ username: string }>("/auth/me"),
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
      analytics?: {
        documentKind: string;
        parser?: string;
        fields?: Array<{
          key: string;
          label: string;
          value: string;
          source?: string;
        }>;
        tableRows: Array<{ key: string; value: string }>;
        metrics: {
          lineCount: number;
          wordCount: number;
          avgConfidence: number;
          fieldCount: number;
        };
      };
      jobs?: Array<{
        jobId: string;
        status: string;
        attempt: number;
        errorMessage?: string | null;
      }>;
    }>(`/documents/${documentId}`),
  updateAnalyticsFields: (
    documentId: string,
    fields: Array<{ key: string; value: string; label?: string }>,
  ) =>
    request<{
      analytics: {
        documentKind: string;
        parser?: string;
        fields: Array<{
          key: string;
          label: string;
          value: string;
          source?: string;
        }>;
        tableRows: Array<{ key: string; value: string }>;
        metrics: {
          lineCount: number;
          wordCount: number;
          avgConfidence: number;
          fieldCount: number;
        };
      };
    }>(`/documents/${documentId}/analytics/fields`, {
      method: "PUT",
      body: JSON.stringify({ fields }),
    }),
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
  analyticsSummary: (from?: string, to?: string) => {
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    const suffix = query.toString() ? `?${query}` : "";
    return request<{
      totals: {
        documentsAnalyzed: number;
        avgConfidence: number;
        totalLines: number;
        totalWords: number;
      };
      series: Array<{
        date: string;
        documentsAnalyzed: number;
        avgConfidence: number;
        totalLines: number;
        totalWords: number;
        byContentType: Record<string, number>;
        byKind: Record<string, number>;
      }>;
      fields: Array<{
        key: string;
        label: string;
        values: Array<{ value: string; count: number }>;
      }>;
      kinds: Array<{ kind: string; count: number }>;
    }>(`/analytics/summary${suffix}`);
  },
  analyticsDocuments: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) query.set(key, value);
    }
    const suffix = query.toString() ? `?${query}` : "";
    return request<{
      total: number;
      filters: Record<string, string>;
      items: Array<{
        documentId: string;
        filename: string;
        contentType: string;
        documentKind: string;
        status: string;
        createdAt: string;
        fields: Record<string, string>;
        metrics: {
          lineCount: number;
          wordCount: number;
          avgConfidence: number;
          fieldCount: number;
        };
      }>;
      fieldBreakdown: Array<{
        key: string;
        label: string;
        values: Array<{ value: string; count: number }>;
      }>;
    }>(`/analytics/documents${suffix}`);
  },
};

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}
