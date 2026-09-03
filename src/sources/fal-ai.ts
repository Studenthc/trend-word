import { parseSourceHealth, type ModelRecord, type SourceContext, type SourceHealth } from "../types.js";

export type FalAiTransport = (request: {
  url: string;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
}) => Promise<{ status: number; headers: Headers; text(): Promise<string> }>;

export type FalAiAdapterOptions = { url?: string; limit?: number };
export type FalAiResult = { models: ModelRecord[]; health: SourceHealth };

const PATH_CAPABILITIES: Record<string, { input: string[]; output: string[] }> = {
  "image-to-video": { input: ["image"], output: ["video"] },
  "text-to-image": { input: ["text"], output: ["image"] },
  "text-to-video": { input: ["text"], output: ["video"] },
  "text-to-speech": { input: ["text"], output: ["audio"] },
  "lip-sync": { input: ["video", "audio"], output: ["video"] },
  "image-editing": { input: ["image", "text"], output: ["image"] },
};

export function createFalAiAdapter(transport: FalAiTransport, options: FalAiAdapterOptions = {}): { collect(context: SourceContext): Promise<FalAiResult> } {
  return {
    async collect(context): Promise<FalAiResult> {
      const limit = boundedLimit(options.limit ?? context.config.modelCatalog?.limitPerPlatform ?? 20);
      const url = options.url ?? "https://fal.ai/explore";
      if (!allowedUrl(url)) return result([], health("unverified", context.fetchedAt, ["fal.ai catalog URL is not HTTPS allow-listed"]));
      try {
        const response = await transport({ url, method: "GET", headers: { accept: "text/html" } });
        if ([401, 403, 429].includes(response.status)) return result([], health("blocked", context.fetchedAt, [`fal.ai HTTP ${response.status} access limited`]));
        if (response.status < 200 || response.status >= 300) return result([], health("unverified", context.fetchedAt, [`fal.ai HTTP ${response.status} response`]));
        const html = await response.text();
        const paths = extractModelPaths(html).slice(0, limit);
        if (paths.length === 0) return result([], health("unverified", context.fetchedAt, ["fal.ai explore parse failed: no model links found"]));
        const models = paths.map((path) => toModelRecord(path, html));
        return result(models, health("partial", context.fetchedAt, [], ["fal.ai public explore HTML has no trustworthy catalog timestamp"]));
      } catch (error) {
        return result([], health("unverified", context.fetchedAt, [`fal.ai HTML/network failure: ${message(error)}`]));
      }
    },
  };
}

function toModelRecord(modelPath: string, html: string): ModelRecord {
  const segments = modelPath.slice("/models/".length).split("/").filter(Boolean);
  const modelName = segments.join("/");
  const slug = segments.at(-1) ?? "";
  const io = PATH_CAPABILITIES[slug];
  const text = anchorText(html, modelPath);
  const claimedCapabilities = unique([slug, ...segments.filter((segment) => PATH_CAPABILITIES[segment])]);
  const id = `fal-ai:${modelName}`;
  return {
    id, platform: "fal-ai", modelName, modelUrl: `https://fal.ai${modelPath}`,
    inputTypes: io?.input ?? [], outputTypes: io?.output ?? [], claimedCapabilities,
    ...(text ? { description: text } : {}), tags: claimedCapabilities,
    notes: ["fal.ai public explore HTML has no trustworthy catalog timestamp"], sourceSignalId: `model-catalog-fal-ai-${modelName.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "")}`,
    evidenceStatus: "partial",
  };
}

function extractModelPaths(html: string): string[] {
  const paths: string[] = [];
  const pattern = /<a\b[^>]*\bhref=["']((?:https:\/\/fal\.ai)?\/models\/[^"'?#<>\s]+)["'][^>]*>/giu;
  for (const match of html.matchAll(pattern)) {
    const raw = decodeHtml(match[1] ?? "").replace(/\/+$/u, "");
    const parsed = raw.startsWith("https://fal.ai") ? new URL(raw).pathname : raw;
    if (!/^\/models\/[^/]+\/[^/]+(?:\/[^/]+)*$/u.test(parsed) || parsed.endsWith("/api") || paths.includes(parsed)) continue;
    paths.push(parsed);
  }
  return paths;
}

function anchorText(html: string, modelPath: string): string | undefined {
  const escaped = modelPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = html.match(new RegExp(`<a\\b[^>]*href=["'](?:https:\\/\\/fal\\.ai)?${escaped}["'][^>]*>([\\s\\S]*?)<\\/a>`, "iu"));
  const inner = match?.[1];
  const alt = inner?.match(/\balt=["']([^"']{2,240})["']/iu)?.[1];
  if (alt) return decodeHtml(alt).trim();
  const text = inner?.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
  if (!text || text.length > 240 || /[{}[\]]/u.test(text) || /try it now|see docs|\bapi\b/iu.test(text)) return undefined;
  return text ? decodeHtml(text).slice(0, 500) : undefined;
}

function allowedUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && (url.hostname === "fal.ai" || url.hostname === "www.fal.ai"); } catch { return false; }
}
function result(models: ModelRecord[], healthValue: SourceHealth): FalAiResult { return { models, health: { ...healthValue, itemCount: models.length } }; }
function health(status: SourceHealth["status"], attemptedAt: string, failureReasons: string[] = [], coverageNotes: string[] = []): SourceHealth { return parseSourceHealth({ sourceType: "model-catalog", status, attemptedAt, itemCount: 0, failureReasons, coverageNotes }); }
function boundedLimit(value: number): number { return Number.isInteger(value) && value > 0 ? Math.min(value, 50) : 20; }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function decodeHtml(value: string): string { return value.replace(/&amp;/gu, "&").replace(/&quot;/gu, '"').replace(/&#39;|&#x27;/giu, "'").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">"); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
