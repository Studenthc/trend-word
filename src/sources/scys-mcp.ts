import { parseRawSignal, parseSourceHealth, type RawSignal, type SourceAdapter, type SourceCollection, type SourceContext } from "../types.js";

export type McpTransport = (request: { method: string; params?: Record<string, unknown> }) => Promise<unknown>;

export type ScysMcpAdapterOptions = { query?: string };

export function createScysMcpAdapter(transport: McpTransport, options: ScysMcpAdapterOptions = {}): SourceAdapter {
  return {
    name: "scys-mcp",
    async collect(context): Promise<SourceCollection> {
      try {
        const search = await transport({ method: "content-search", params: { query: options.query ?? "AI" } });
        const items = searchItems(search);
        if (!items) return collection("unverified", context.fetchedAt, [], ["SCYS MCP content-search parse failed"]);
        if (items.length === 0) return collection("empty", context.fetchedAt, []);
        const signals: RawSignal[] = [];
        const warnings: string[] = [];
        for (const item of items) {
          try {
            const detail = hasText(item, "title") || hasText(item, "body") ? item : await transport({ method: "topic-detail", params: { id: text(item, "id") } });
            signals.push(toSignal(detail, context.fetchedAt));
          } catch (error) {
            warnings.push(`topic detail failed: ${message(error)}`);
          }
        }
        return collection(signals.length === 0 ? "unverified" : warnings.length > 0 ? "partial" : "available", context.fetchedAt, signals, warnings, warnings.length > 0 ? ["some SCYS topic details unavailable"] : []);
      } catch (error) {
        return collection("unverified", context.fetchedAt, [], [`SCYS MCP failed: ${message(error)}`]);
      }
    },
  };
}

export const scysMcpAdapter = createScysMcpAdapter;

function searchItems(value: unknown): Record<string, unknown>[] | undefined {
  const payload = unwrapMcpPayload(value);
  if (!record(payload)) return undefined;
  const items = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.results) ? payload.results : undefined;
  return items?.filter(record);
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
