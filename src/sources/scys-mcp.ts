import { parseRawSignal, parseSourceHealth, type RawSignal, type SourceAdapter, type SourceCollection, type SourceContext } from "../types.js";

export type McpTransport = (request: { method: string; params?: Record<string, unknown> }) => Promise<unknown>;

export type ScysMcpAdapterOptions = { query?: string; queries?: string[] };

export function createScysMcpAdapter(transport: McpTransport, options: ScysMcpAdapterOptions = {}): SourceAdapter {
  return {
    name: "scys-mcp",
    async collect(context): Promise<SourceCollection> {
      const queries = options.queries?.length ? options.queries : [options.query ?? "AI"];
      const signalsById = new Map<string, RawSignal>();
      const failures: string[] = [];
      const failureStatuses: number[] = [];
      let successfulQueries = 0;
      for (const query of queries) {
        try {
          const search = await transport({ method: "content-search", params: { query } });
          const status = responseStatus(search);
          if (status !== undefined && status >= 400) throw Object.assign(new Error(`HTTP ${status}`), { status });
          const items = searchItems(search);
          if (!items) throw new Error("content-search parse failed");
          successfulQueries += 1;
          for (const item of items) {
            try {
              const detail = hasText(item, "title") || hasText(item, "body") ? item : await transport({ method: "topic-detail", params: { id: text(item, "id") } });
              const signal = toSignal(detail, context.fetchedAt);
              signalsById.set(signal.id, signal);
            } catch (error) {
              failures.push(`topic detail failed for ${query}: ${message(error)}`);
            }
          }
        } catch (error) {
          const status = errorStatus(error);
          if (status !== undefined) failureStatuses.push(status);
          failures.push(`SCYS query ${query} failed: ${message(error)}`);
        }
      }
      const signals = [...signalsById.values()];
      const signalWarnings = signals.flatMap((signal) => [
        ...(signal.permission === "restricted" ? ["permission restricted"] : []),
        ...(signal.syncWarnings ?? []),
      ]);
      const allWarnings = [...failures, ...signalWarnings];
      if (signals.length > 0) return collection(allWarnings.length > 0 ? "partial" : "available", context.fetchedAt, signals, failures, allWarnings.length > 0 ? [`SCYS permission or sync warnings: ${allWarnings.join("; ")}`] : []);
      if (failures.length > 0 && successfulQueries > 0) return collection("partial", context.fetchedAt, [], failures);
      if (failures.length > 0) return collection(failureStatuses.some((status) => [401, 403, 404, 429].includes(status)) ? "blocked" : "unverified", context.fetchedAt, [], failures);
      return collection("empty", context.fetchedAt, []);
    },
  };
}

export const scysMcpAdapter = createScysMcpAdapter;

function searchItems(value: unknown): Record<string, unknown>[] | undefined {
  const payload = unwrapMcpPayload(value);
  if (!record(payload)) return undefined;
  const items = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.results) ? payload.results : undefined;
  if (items?.some((item) => !record(item))) throw new Error("malformed content-search item");
  return items as Record<string, unknown>[] | undefined;
}

function toSignal(value: unknown, fetchedAt: string): RawSignal {
  const payload = unwrapMcpPayload(value);
  if (!record(payload)) throw new Error("topic detail is not an object");
  const id = text(payload, "id");
  const title = text(payload, "title");
  const body = text(payload, "body") ?? text(payload, "content");
  if (!id || !title || !body) throw new Error("topic detail missing id, title, or body");
  const author = record(payload.author) ? payload.author : undefined;
  const comments = number(payload.comments) ?? number(payload.commentsCount);
  const engagement = record(payload.engagement) ? payload.engagement : undefined;
  const warnings = arrayOfText(payload.syncWarnings);
  const permission = text(payload, "permission");
  return parseRawSignal({ id: `scys-${id}`, sourceType: "scys-mcp", sourceName: "生财风向标", sourceUrl: text(payload, "url") ?? `https://scys.example.com/content/${id}`, externalId: id, title, body, excerpt: text(payload, "excerpt"), author: { name: author ? text(author, "name") ?? "Unknown author" : text(payload, "author") ?? "Unknown author", ...(author && text(author, "id") ? { id: text(author, "id") } : {}) }, publishedAt: text(payload, "publishedAt") ?? text(payload, "published_at"), fetchedAt, language: "zh-CN", sourceTier: "community", engagement: { ...(comments !== undefined ? { comments } : {}), ...(engagement && number(engagement.likes) !== undefined ? { likes: number(engagement.likes) } : {}) }, tags: arrayOfText(payload.tags), permission, syncWarnings: warnings, sourceFingerprint: `scys:${id}`, evidenceStatus: warnings.length > 0 || permission === "restricted" ? "partial" : "verified", failureReason: warnings.length > 0 ? warnings.join("; ") : undefined });
}

function unwrapMcpPayload(value: unknown): unknown {
  if (!record(value)) return value;
  if ("result" in value) return unwrapMcpPayload(value.result);
  if (Array.isArray(value.content)) {
    const textBlock = value.content.find((item) => record(item) && typeof item.text === "string");
    if (textBlock && typeof textBlock.text === "string") {
      try { return JSON.parse(textBlock.text) as unknown; } catch { return textBlock.text; }
    }
  }
  return value;
}

function collection(status: "available" | "partial" | "blocked" | "empty" | "unverified", attemptedAt: string, signals: RawSignal[], failureReasons: string[] = [], coverageNotes: string[] = []): SourceCollection { return { signals, health: parseSourceHealth({ sourceType: "scys-mcp", status, attemptedAt, itemCount: signals.length, failureReasons, coverageNotes }) }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: Record<string, unknown>, key: string): string | undefined { return typeof value[key] === "string" && value[key].trim() ? value[key].trim() : undefined; }
function hasText(value: Record<string, unknown>, key: string): boolean { return Boolean(text(value, key)); }
function number(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function arrayOfText(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : []; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function errorStatus(error: unknown): number | undefined { return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined; }
function responseStatus(value: unknown): number | undefined { return record(value) && typeof value.status === "number" ? value.status : undefined; }
