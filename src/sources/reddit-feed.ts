import { parseRawSignal, parseSourceHealth, type RawSignal, type SourceAdapter, type SourceCollection } from "../types.js";

export type HttpTransport = (request: {
  url: string;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
}) => Promise<{ status: number; headers: Headers; text(): Promise<string> }>;

export type RedditFeedParser = "json" | "rss" | "page" | ((text: string, contentType: string) => unknown[]);
export type RedditFeedAdapterOptions = { communities?: string[]; parser?: RedditFeedParser; baseUrl?: string };

export function createRedditFeedAdapter(transport: HttpTransport, options: RedditFeedAdapterOptions = {}): SourceAdapter {
  return {
    name: "reddit-feed",
    async collect(context): Promise<SourceCollection> {
      const communities = [...new Set((options.communities ?? []).map((community) => community.trim().replace(/^r\//u, "")).filter(Boolean))];
      if (communities.length === 0) return collection("unverified", context.fetchedAt, [], ["no configured Reddit communities"], ["global search is not used; no community was queried"], 0, 0);
      const signals: RawSignal[] = [];
      const failures: string[] = [];
      const failureStatuses: number[] = [];
      let successfulEndpoints = 0;
      for (const community of communities) {
        try {
          const response = await transport({ url: `${options.baseUrl ?? "https://www.reddit.example"}/r/${encodeURIComponent(community)}/new.json`, method: "GET" });
          if (response.status < 200 || response.status >= 300) throw Object.assign(new Error(`HTTP ${response.status} for r/${community}`), { status: response.status });
          const body = await response.text();
          const items = parseFeed(body, response.headers.get("content-type") ?? "", options.parser);
          successfulEndpoints += 1;
          for (const item of items) {
            try { signals.push(toSignal(item, community, context.fetchedAt)); } catch (error) { failures.push(`r/${community} item failed: ${message(error)}`); }
          }
        } catch (error) {
          const status = errorStatus(error);
          if (status !== undefined) failureStatuses.push(status);
          failures.push(`r/${community} failed: ${message(error)}`);
        }
      }
      const status = signals.length > 0 ? failures.length > 0 ? "partial" : "available" : failures.length > 0 ? successfulEndpoints > 0 ? "partial" : failureStatuses.some((value) => [403, 429].includes(value)) ? "blocked" : "unverified" : "empty";
      return collection(status, context.fetchedAt, signals, failures, failures.length > 0 ? ["Reddit coverage is incomplete; failed communities are not absence evidence"] : [], communities.length, successfulEndpoints);
    },
  };
}

export const redditFeedAdapter = createRedditFeedAdapter;

function parseFeed(text: string, contentType: string, parser: RedditFeedParser | undefined): unknown[] {
  if (typeof parser === "function") return parser(text, contentType);
  const mode = parser ?? (contentType.includes("xml") || text.trim().startsWith("<") ? "rss" : "json");
  if (mode === "json") {
    const value = JSON.parse(text) as unknown;
    if (!record(value)) throw new Error("Reddit JSON feed malformed");
    if (record(value.data) && Array.isArray(value.data.children)) return value.data.children.map((child) => record(child) && record(child.data) ? child.data : child);
    if (Array.isArray(value.items)) return value.items;
    if (Array.isArray(value.posts)) return value.posts;
    throw new Error("Reddit JSON feed missing items");
  }
  if (mode === "rss") return parseRss(text);
  return parsePage(text);
}

function parseRss(text: string): unknown[] {
  const items: Record<string, string>[] = [];
  for (const match of text.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const body = match[1] ?? "";
    const get = (tag: string) => decodeXml(body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "");
    items.push({ id: get("guid") || get("link"), title: get("title"), url: get("link"), body: get("description"), publishedAt: get("pubDate"), author: get("author") });
  }
  return items;
}

function parsePage(text: string): unknown[] {
  const items: Record<string, string>[] = [];
  for (const match of text.matchAll(/<article[^>]*data-id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/article>/gi)) {
    const body = match[2] ?? "";
    const title = body.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] ?? "";
    items.push({ id: match[1] ?? "", title: stripTags(title), body: stripTags(body) });
  }
  return items;
}

function toSignal(value: unknown, community: string, fetchedAt: string): RawSignal {
  if (!record(value)) throw new Error("Reddit post malformed");
  const id = text(value, "id") ?? text(value, "name");
  const title = text(value, "title");
  if (!id || !title) throw new Error("Reddit post missing id or title");
  const body = text(value, "selftext") ?? text(value, "body") ?? text(value, "description");
  return parseRawSignal({ id: `reddit-${id}`, sourceType: "reddit-feed", sourceName: `Reddit r/${community}`, sourceUrl: text(value, "url") ?? `https://www.reddit.com/r/${community}/comments/${id}`, externalId: id, title, body, excerpt: body, author: { name: text(value, "author") ?? "Unknown author" }, community: `r/${community}`, publishedAt: text(value, "created_at") ?? text(value, "publishedAt") ?? text(value, "pubDate"), fetchedAt, sourceTier: "community", engagement: { ...(number(value.score) !== undefined ? { score: number(value.score) } : {}), ...(number(value.num_comments) !== undefined ? { comments: number(value.num_comments) } : {}) }, sourceFingerprint: `reddit:${id}`, evidenceStatus: "verified" });
}

function collection(status: "available" | "partial" | "blocked" | "empty" | "unverified", attemptedAt: string, signals: RawSignal[], failureReasons: string[], coverageNotes: string[], endpointCount: number, successfulEndpointCount: number): SourceCollection { return { signals, health: parseSourceHealth({ sourceType: "reddit-feed", status, attemptedAt, endpointCount, successfulEndpointCount, itemCount: signals.length, failureReasons, coverageNotes }) }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: Record<string, unknown>, key: string): string | undefined { return typeof value[key] === "string" && value[key].trim() ? decodeXml(value[key].trim()) : undefined; }
function number(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function stripTags(value: string): string { return decodeXml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()); }
function decodeXml(value: string): string { return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function errorStatus(error: unknown): number | undefined { return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined; }
