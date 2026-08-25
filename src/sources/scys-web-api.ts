import type { McpTransport } from "./scys-mcp.js";

export type ScysWebResponse = {
  status: number;
  json(): Promise<unknown>;
};

export type ScysWebFetcher = (url: string, init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string }) => Promise<ScysWebResponse>;

export type ScysWebApiOptions = {
  baseUrl?: string;
  activityId: number;
  category?: string;
  perPage?: number;
  headers?: Record<string, string>;
};

/**
 * Bridges the authenticated SCYS web API to the existing source adapter.
 * Headers are runtime-only: callers must supply them from their auth runtime.
 */
export function createScysWebApiTransport(fetcher: ScysWebFetcher, options: ScysWebApiOptions): McpTransport {
  const baseUrl = (options.baseUrl ?? "https://scys.com").replace(/\/$/, "");
  const headers = { "content-type": "application/json", ...(options.headers ?? {}) };
  return async (request) => {
    if (request.method === "content-search") {
      const response = await fetcher(`${baseUrl}/activity/search/data`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          category: options.category ?? "资料",
          page: 1,
          perPage: options.perPage ?? 20,
          keyword: String(request.params?.query ?? ""),
          activity_id: options.activityId,
        }),
      });
      return normalizeResponse(response);
    }
    if (request.method === "topic-detail") {
      const id = String(request.params?.id ?? "");
      const response = await fetcher(`${baseUrl}/activity/documents/booksdetail?id=${encodeURIComponent(id)}`, { method: "GET", headers });
      return normalizeResponse(response);
    }
    throw new Error(`unsupported SCYS web method: ${request.method}`);
  };
}

async function normalizeResponse(response: ScysWebResponse): Promise<unknown> {
  if (response.status >= 400) return { status: response.status };
  const payload = await response.json();
  if (isRecord(payload) && "data" in payload && payload.data !== undefined) return payload.data;
  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
