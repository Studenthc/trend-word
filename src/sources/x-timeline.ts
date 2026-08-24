import { parseRawSignal, parseSourceHealth, type RawSignal, type SourceAdapter, type SourceCollection } from "../types.js";
import { retryTransient } from "./retry.js";

export type HttpTransport = (request: {
  url: string;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
}) => Promise<{ status: number; headers: Headers; text(): Promise<string> }>;

export type XTimelineAdapterOptions = { handles?: string[]; baseUrl?: string };

export function createXTimelineAdapter(transport: HttpTransport, options: XTimelineAdapterOptions = {}): SourceAdapter {
  return {
    name: "x-timeline",
    async collect(context): Promise<SourceCollection> {
      const handles = [...new Set((options.handles ?? []).map((handle) => handle.trim().replace(/^@/u, "")).filter(Boolean))];
      if (handles.length === 0) return collection("unverified", context.fetchedAt, [], ["no configured X handles"], ["global search is not used; no account was queried"], 0, 0);
      const signals: RawSignal[] = [];
      const failures: string[] = [];
      const failureStatuses: number[] = [];
      let successfulEndpoints = 0;
      for (const handle of handles) {
        try {
          const baseUrl = options.baseUrl ?? "https://api.x.example/timeline";
          const response = await retryTransient(() => transport({ url: `${baseUrl}/${encodeURIComponent(handle)}/tweets`, method: "GET" }));
          if (response.status < 200 || response.status >= 300) throw Object.assign(new Error(`HTTP ${response.status} for @${handle}`), { status: response.status });
          const payload = JSON.parse(await response.text()) as unknown;
          const items = timelineItems(payload);
          if (!items) throw new Error(`timeline parse failed for @${handle}`);
          successfulEndpoints += 1;
          for (const item of items) {
            try { signals.push(toSignal(item, handle, context.fetchedAt)); } catch (error) { failures.push(`@${handle} item failed: ${message(error)}`); }
          }
        } catch (error) {
          const status = errorStatus(error);
          if (status !== undefined) failureStatuses.push(status);
          failures.push(`@${handle} unavailable: ${message(error)}`);
        }
      }
      const status = signals.length > 0 ? failures.length > 0 ? "partial" : "available" : failures.length > 0 ? successfulEndpoints > 0 || failureStatuses.some((value) => [401, 403, 404].includes(value)) ? "partial" : "unverified" : "empty";
      return collection(status, context.fetchedAt, signals, failures, failures.length > 0 ? ["X timeline coverage is incomplete; unavailable accounts are not absence evidence"] : [], handles.length, successfulEndpoints);
    },
  };
}

export const xTimelineAdapter = createXTimelineAdapter;

function timelineItems(value: unknown): Record<string, unknown>[] | undefined {
  if (!record(value)) return undefined;
  const items = Array.isArray(value.data) ? value.data : Array.isArray(value.items) ? value.items : undefined;
  if (items?.some((item) => !record(item))) throw new Error("malformed timeline item");
  return items as Record<string, unknown>[] | undefined;
}

function toSignal(item: Record<string, unknown>, handle: string, fetchedAt: string): RawSignal {
  const id = text(item, "id");
  const body = text(item, "text") ?? text(item, "body");
  if (!id || !body) throw new Error("timeline item missing id or text");
  const metrics = record(item.public_metrics) ? item.public_metrics : record(item.engagement) ? item.engagement : undefined;
  const author = record(item.author) ? item.author : undefined;
  const authorName = author ? text(author, "name") ?? text(author, "username") : text(item, "author") ?? handle;
  return parseRawSignal({ id: `x-${id}`, sourceType: "x-timeline", sourceName: "X timeline", sourceUrl: text(item, "url") ?? `https://x.com/${handle}/status/${id}`, externalId: id, title: body.slice(0, 120), body, author: { name: authorName, ...(author && text(author, "id") ? { id: text(author, "id") } : {}) }, publishedAt: text(item, "created_at") ?? text(item, "publishedAt"), fetchedAt, sourceTier: "community", engagement: metrics ? { ...(number(metrics.like_count) ?? number(metrics.likes) !== undefined ? { likes: number(metrics.like_count) ?? number(metrics.likes) } : {}), ...(number(metrics.reply_count) ?? number(metrics.comments) !== undefined ? { comments: number(metrics.reply_count) ?? number(metrics.comments) } : {}), ...(number(metrics.retweet_count) ?? number(metrics.shares) !== undefined ? { shares: number(metrics.retweet_count) ?? number(metrics.shares) } : {}) } : undefined, sourceFingerprint: `x:${id}`, evidenceStatus: "verified" });
}

function collection(status: "available" | "partial" | "blocked" | "empty" | "unverified", attemptedAt: string, signals: RawSignal[], failureReasons: string[], coverageNotes: string[], endpointCount: number, successfulEndpointCount: number): SourceCollection { return { signals, health: parseSourceHealth({ sourceType: "x-timeline", status, attemptedAt, endpointCount, successfulEndpointCount, itemCount: signals.length, failureReasons, coverageNotes }) }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: Record<string, unknown>, key: string): string | undefined { return typeof value[key] === "string" && value[key].trim() ? value[key].trim() : undefined; }
function number(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function errorStatus(error: unknown): number | undefined { return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined; }
