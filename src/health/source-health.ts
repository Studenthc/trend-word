import type { SourceHealth, SourceHealthStatus, SourceType } from "../types.js";

export type SourceErrorCategory =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "invalid_json"
  | "missing_credentials"
  | "transient_network"
  | "unknown";

export type ClassifiedSourceError = {
  category: SourceErrorCategory;
  message: string;
  retryable: boolean;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown source error";
}

function errorProperty(error: unknown, key: "status" | "code"): string | number | undefined {
  if (typeof error !== "object" || error === null || !(key in error)) return undefined;
  const value = error[key as keyof typeof error];
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

export function classifySourceError(error: unknown): ClassifiedSourceError {
  const message = errorMessage(error);
  const status = errorProperty(error, "status");
  const code = errorProperty(error, "code");
  const probe = `${message} ${status ?? ""} ${code ?? ""}`;
  if (/\b401\b|unauthorized/i.test(probe)) return { category: "unauthorized", message, retryable: false };
  if (/\b403\b|forbidden/i.test(probe)) return { category: "forbidden", message, retryable: false };
  if (/\b404\b|not found/i.test(probe)) return { category: "not_found", message, retryable: false };
  if (/\b429\b|rate.?limit|too many requests/i.test(probe)) return { category: "rate_limited", message, retryable: false };
  if (/invalid json|json parse|unexpected token.*json/i.test(message)) return { category: "invalid_json", message, retryable: false };
  if (/missing (?:credentials|credential|token|api key)|(?:credentials|token|api key).*missing/i.test(message)) return { category: "missing_credentials", message, retryable: false };
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|network|timeout/i.test(probe)) return { category: "transient_network", message, retryable: true };
  return { category: "unknown", message, retryable: false };
}

export function failureHealth(sourceType: SourceType, classified: ClassifiedSourceError, attemptedAt: string): SourceHealth {
  const status: SourceHealthStatus = classified.category === "transient_network" || classified.category === "unknown" ? "unverified" : "blocked";
  return {
    sourceType,
    status,
    attemptedAt,
    itemCount: 0,
    failureReasons: [`${classified.category}: ${classified.message}`],
    coverageNotes: [`${classified.category}; source coverage unavailable; no new words cannot be inferred`],
  };
}

export function normalizeSourceHealth(sourceType: SourceType, health: SourceHealth, itemCount: number, attemptedAt: string): SourceHealth {
  return {
    ...health,
    sourceType,
    attemptedAt,
    itemCount,
    status: health.status === "available" && itemCount === 0 ? "empty" : health.status,
  };
}
