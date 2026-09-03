import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RawSignal } from "../types.js";

type DetailTransport = (request: { url: string; method?: "GET" | "POST"; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; headers: Headers; text(): Promise<string> }>;
export type DetailResult = { status: "success" | "empty" | "failed"; body?: string; fetchedAt: string; errorCode?: string };
export type DetailTransports = { github?: DetailTransport; producthunt?: DetailTransport };

export async function fetchEntityDetail(signal: RawSignal, transport: DetailTransport, fetchedAt = new Date().toISOString()): Promise<DetailResult> {
  const request = detailRequest(signal);
  if (!request) return { status: "failed", fetchedAt, errorCode: "detail_url_not_allowed" };
  try {
    const response = await transport(request);
    if ([401, 403].includes(response.status)) return { status: "failed", fetchedAt, errorCode: "detail_forbidden" };
    if (response.status === 404) return { status: "failed", fetchedAt, errorCode: "detail_not_found" };
    if (response.status === 429) return { status: "failed", fetchedAt, errorCode: "detail_rate_limited" };
    if (response.status < 200 || response.status >= 300) return { status: "failed", fetchedAt, errorCode: response.status >= 500 ? "detail_upstream_error" : "detail_http_error" };
    const body = parseDetail(signal.sourceType, await response.text());
    return body ? { status: "success", body, fetchedAt } : { status: "empty", fetchedAt, errorCode: "no_demand_evidence" };
  } catch {
    return { status: "failed", fetchedAt, errorCode: "detail_timeout_or_network" };
  }
}

export function mergeEntityDetail(signal: RawSignal, detail: DetailResult): RawSignal {
  if (detail.status !== "success" || !detail.body?.trim()) return signal;
  const body = detail.body.trim();
  if ((signal.body?.length ?? 0) >= body.length) return signal;
  return { ...signal, body };
}

export async function enrichSignalsWithDetails(signals: RawSignal[], transports: DetailTransports, workspaceRoot: string, fetchedAt: string, limit = 20): Promise<{ signals: RawSignal[]; results: DetailResult[] }> {
  const cachePath = path.join(workspaceRoot, "data", "cache", "entity-details.json");
  const cache = await readCache(cachePath);
  const selected = signals.filter((signal) => signal.sourceType === "github" || signal.sourceType === "producthunt").slice(0, limit);
  const results: DetailResult[] = [];
  const enriched = [...signals];
  for (const signal of selected) {
    const key = detailKey(signal);
    let detail = cache[key];
    if (!detail || detail.status === "failed") {
      const transport = signal.sourceType === "github" ? transports.github : transports.producthunt;
      if (!transport) continue;
      detail = await fetchEntityDetail(signal, transport, fetchedAt);
      cache[key] = detail;
    }
    results.push(detail);
    const index = enriched.findIndex((item) => item.id === signal.id);
    if (index >= 0) enriched[index] = mergeEntityDetail(enriched[index]!, detail);
  }
  await writeCache(cachePath, cache);
  return { signals: enriched, results };
}

function detailRequest(signal: RawSignal): { url: string; method: "GET" | "POST"; headers?: Record<string, string>; body?: string } | undefined {
  if (signal.sourceType === "github" && allowedSourceUrl(signal.sourceUrl, "github.com") && signal.externalId && /^[^/\s]+\/[^/\s]+$/u.test(signal.externalId)) {
    return { url: `https://api.github.com/repos/${signal.externalId}/readme`, method: "GET", headers: { accept: "application/vnd.github+json" } };
  }
  if (signal.sourceType === "producthunt" && allowedSourceUrl(signal.sourceUrl, "producthunt.com") && signal.externalId && /^[-\w]+$/u.test(signal.externalId)) {
    const query = `query { post(id: "${signal.externalId}") { description tagline } }`;
    return { url: "https://api.producthunt.com/v2/api/graphql", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) };
  }
  return undefined;
}

function allowedSourceUrl(value: string, hostname: string): boolean {
  try { const parsed = new URL(value); return parsed.protocol === "https:" && (parsed.hostname === hostname || parsed.hostname === `www.${hostname}`); } catch { return false; }
}

function detailKey(signal: RawSignal): string { return `${signal.sourceType}:${signal.externalId ?? signal.sourceUrl}`; }
async function readCache(filePath: string): Promise<Record<string, DetailResult>> {
  try { return JSON.parse(await readFile(filePath, "utf8")) as Record<string, DetailResult>; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; return {}; }
}
async function writeCache(filePath: string, cache: Record<string, DetailResult>): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(cache), "utf8");
  await rename(temp, filePath);
}

function parseDetail(sourceType: RawSignal["sourceType"], text: string): string | undefined {
  if (sourceType === "github") {
    try {
      const value = JSON.parse(text) as { content?: unknown; encoding?: unknown };
      if (typeof value.content !== "string") return undefined;
      return value.encoding === "base64" ? Buffer.from(value.content.replace(/\s+/gu, ""), "base64").toString("utf8").trim() : value.content.trim();
    } catch { return text.trim() || undefined; }
  }
  try {
    const value = JSON.parse(text) as { data?: { post?: { description?: unknown; tagline?: unknown } } };
    const post = value.data?.post;
    return [post?.description, post?.tagline].find((item): item is string => typeof item === "string" && item.trim().length > 0)?.trim();
  } catch { return undefined; }
}
