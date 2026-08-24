import { parseRawSignal, parseSourceHealth, type RawSignal, type SourceAdapter, type SourceCollection, type SourceContext } from "../types.js";

export type HttpTransport = (request: {
  url: string;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
}) => Promise<{ status: number; headers: Headers; text(): Promise<string> }>;

export type ProductHuntAdapterOptions = { url?: string };

export function createProductHuntAdapter(transport: HttpTransport, options: ProductHuntAdapterOptions = {}): SourceAdapter {
  return {
    name: "producthunt",
    async collect(context): Promise<SourceCollection> {
      const attemptedAt = context.fetchedAt;
      try {
        const response = await transport({ url: options.url ?? "https://api.producthunt.com/v2/posts", method: "GET" });
        if (response.status === 403 || response.status === 429) return collection("blocked", attemptedAt, [], [`HTTP ${response.status} Product Hunt access limited`]);
        if (response.status < 200 || response.status >= 300) return collection("unverified", attemptedAt, [], [`HTTP ${response.status} Product Hunt response`]);
        const payload = parseJson(await response.text());
        const nodes = productNodes(payload);
        if (!nodes) return collection("unverified", attemptedAt, [], ["Product Hunt feed parse failed: missing posts"]);
        const signals = nodes.map((node) => toSignal(node, attemptedAt));
        const commentsUnavailable = signals.some((signal) => signal.engagement?.comments === undefined);
        return collection(signals.length === 0 ? "empty" : commentsUnavailable ? "partial" : "available", attemptedAt, signals, [], commentsUnavailable ? ["comments unavailable in launch feed"] : []);
      } catch (error) {
        return collection("unverified", attemptedAt, [], [`Product Hunt JSON parse failed: ${message(error)}`]);
      }
    },
  };
}

export const productHuntAdapter = createProductHuntAdapter;

function productNodes(value: unknown): Record<string, unknown>[] | undefined {
  if (!record(value)) return undefined;
  const posts = record(value.data) && record(value.data.posts) ? value.data.posts : value.posts ?? value.items;
  if (Array.isArray(posts)) return posts.filter(record);
  if (record(posts) && Array.isArray(posts.edges)) return posts.edges.map((edge) => record(edge) && record(edge.node) ? edge.node : undefined).filter((item): item is Record<string, unknown> => Boolean(item));
  return undefined;
}

function toSignal(node: Record<string, unknown>, fetchedAt: string): RawSignal {
  const id = text(node, "id");
  const title = text(node, "name") ?? text(node, "title");
  const sourceUrl = text(node, "url");
  if (!id || !title || !sourceUrl) throw new Error("launch missing id, title, or url");
  const user = record(node.user) ? node.user : record(node.maker) ? node.maker : undefined;
  const comments = number(node.commentsCount) ?? number(node.comments);
  return parseRawSignal({
    id: `producthunt-${id}`, sourceType: "producthunt", sourceName: "Product Hunt", sourceUrl, externalId: id,
    title, excerpt: text(node, "tagline") ?? text(node, "description"), author: user ? { name: text(user, "name") ?? "Unknown maker", ...(text(user, "id") ? { id: text(user, "id") } : {}), ...(text(user, "url") ? { profileUrl: text(user, "url") } : {}) } : undefined,
    publishedAt: text(node, "createdAt") ?? text(node, "launchDate"), fetchedAt, sourceTier: "market", engagement: { ...(number(node.votesCount) ?? number(node.votes) !== undefined ? { likes: number(node.votesCount) ?? number(node.votes), votes: number(node.votesCount) ?? number(node.votes) } : {}), ...(comments !== undefined ? { comments } : {}) }, sourceFingerprint: `producthunt:${id}`, evidenceStatus: "verified",
  });
}

function collection(status: "available" | "partial" | "blocked" | "empty" | "unverified", attemptedAt: string, signals: RawSignal[], failureReasons: string[] = [], coverageNotes: string[] = []): SourceCollection {
  return { signals, health: parseSourceHealth({ sourceType: "producthunt", status, attemptedAt, itemCount: signals.length, failureReasons, coverageNotes }) };
}
function parseJson(value: string): unknown { try { return JSON.parse(value) as unknown; } catch (error) { throw new Error(message(error)); } }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: Record<string, unknown>, key: string): string | undefined { return typeof value[key] === "string" && value[key].trim() ? value[key].trim() : undefined; }
function number(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
