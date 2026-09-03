import { parseSourceHealth, type ModelRecord, type SourceContext, type SourceHealth } from "../types.js";

export type HuggingFaceTransport = (request: {
  url: string;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
}) => Promise<{ status: number; headers: Headers; text(): Promise<string> }>;

export type HuggingFaceAdapterOptions = { url?: string; recentDays?: number; limit?: number };
export type HuggingFaceResult = { models: ModelRecord[]; health: SourceHealth };

const DAY_MS = 86_400_000;
const TASK_IO: Record<string, { input: string[]; output: string[] }> = {
  "image-to-video": { input: ["image"], output: ["video"] },
  "text-to-image": { input: ["text"], output: ["image"] },
  "text-to-video": { input: ["text"], output: ["video"] },
  "text-to-speech": { input: ["text"], output: ["audio"] },
  "automatic-speech-recognition": { input: ["audio"], output: ["text"] },
  translation: { input: ["text"], output: ["text"] },
  "image-to-image": { input: ["image"], output: ["image"] },
  "image-text-to-text": { input: ["image", "text"], output: ["text"] },
};

export function createHuggingFaceAdapter(transport: HuggingFaceTransport, options: HuggingFaceAdapterOptions = {}): { collect(context: SourceContext): Promise<HuggingFaceResult> } {
  return {
    async collect(context): Promise<HuggingFaceResult> {
      const limit = boundedLimit(options.limit ?? context.config.modelCatalog?.limitPerPlatform ?? 20);
      const recentDays = boundedRecentDays(options.recentDays ?? context.config.modelCatalog?.recentDays ?? 7);
      const baseUrl = options.url ?? "https://huggingface.co/api/models";
      const url = new URL(baseUrl);
      url.searchParams.set("sort", "lastModified");
      url.searchParams.set("direction", "-1");
      url.searchParams.set("limit", String(limit));
      try {
        const response = await transport({ url: url.toString(), method: "GET", headers: { accept: "application/json" } });
        if ([401, 403, 429].includes(response.status)) return result([], health("blocked", context.fetchedAt, [`Hugging Face HTTP ${response.status} access limited`]));
        if (response.status < 200 || response.status >= 300) return result([], health("unverified", context.fetchedAt, [`Hugging Face HTTP ${response.status} response`]));
        const payload = JSON.parse(await response.text()) as unknown;
        const nodes = modelNodes(payload);
        if (!nodes) return result([], health("unverified", context.fetchedAt, ["Hugging Face response parse failed: missing model array"]));
        const failures: string[] = [];
        const models: ModelRecord[] = [];
        const seen = new Set<string>();
        const cutoff = Date.parse(context.fetchedAt) - recentDays * DAY_MS;
        for (const node of nodes) {
          try {
            const model = toModelRecord(node, context.fetchedAt, cutoff);
            if (!model || seen.has(model.id)) continue;
            seen.add(model.id);
            models.push(model);
            if (models.length >= limit) break;
          } catch (error) {
            failures.push(`model item failed: ${message(error)}`);
          }
        }
        if (models.length === 0 && failures.length > 0) return result([], health("unverified", context.fetchedAt, failures));
        const hasPartial = models.some((model) => model.evidenceStatus === "partial") || failures.length > 0;
        return result(models, health(models.length === 0 ? "empty" : hasPartial ? "partial" : "available", context.fetchedAt, failures));
      } catch (error) {
        return result([], health("unverified", context.fetchedAt, [`Hugging Face JSON/network failure: ${message(error)}`]));
      }
    },
  };
}

function toModelRecord(node: Record<string, unknown>, fetchedAt: string, cutoff: number): ModelRecord | undefined {
  const modelName = text(node, "modelId") ?? text(node, "id");
  if (!modelName || /\s/u.test(modelName) || !modelName.includes("/")) throw new Error("missing valid modelId");
  const updatedAt = text(node, "lastModified") ?? text(node, "updatedAt");
  const createdAt = text(node, "createdAt");
  const timestamp = Date.parse(updatedAt ?? createdAt ?? "");
  if (Number.isFinite(timestamp) && timestamp < cutoff) return undefined;
  const pipeline = text(node, "pipeline_tag");
  const tags = stringArray(node.tags);
  const claimedCapabilities = unique([...(pipeline ? [pipeline] : []), ...tags]);
  const io = pipeline ? TASK_IO[pipeline] : undefined;
  const notes = [...(!Number.isFinite(timestamp) ? ["missing trustworthy created/updated timestamp"] : [])];
  const metrics = {
    ...(number(node.likes) !== undefined ? { likes: number(node.likes) } : {}),
    ...(number(node.downloads) !== undefined ? { downloads: number(node.downloads) } : {}),
  };
  return {
    id: `huggingface:${modelName}`,
    platform: "huggingface",
    modelName,
    modelUrl: `https://huggingface.co/${modelName.split("/").map(encodeURIComponent).join("/")}`,
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    inputTypes: io?.input ?? [],
    outputTypes: io?.output ?? [],
    claimedCapabilities,
    ...(text(node, "description") ? { description: text(node, "description") } : {}),
    tags,
    ...(Object.keys(metrics).length > 0 ? { publicMetrics: metrics } : {}),
    notes,
    sourceSignalId: `model-catalog-huggingface-${modelName.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "")}`,
    evidenceStatus: notes.length > 0 ? "partial" : "verified",
  };
}

function modelNodes(value: unknown): Record<string, unknown>[] | undefined {
  const nodes = Array.isArray(value) ? value : record(value) && Array.isArray(value.items) ? value.items : undefined;
  if (!nodes || nodes.some((item) => !record(item))) return undefined;
  return nodes as Record<string, unknown>[];
}

function result(models: ModelRecord[], healthValue: SourceHealth): HuggingFaceResult { return { models, health: { ...healthValue, itemCount: models.length } }; }
function health(status: SourceHealth["status"], attemptedAt: string, failureReasons: string[] = []): SourceHealth { return parseSourceHealth({ sourceType: "model-catalog", status, attemptedAt, itemCount: 0, failureReasons, coverageNotes: [] }); }
function boundedLimit(value: number): number { return Number.isInteger(value) && value > 0 ? Math.min(value, 50) : 20; }
function boundedRecentDays(value: number): number { return Number.isInteger(value) && value > 0 ? Math.min(value, 30) : 7; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: Record<string, unknown>, key: string): string | undefined { return typeof value[key] === "string" && value[key].trim() ? value[key].trim() : undefined; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : []; }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function number(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
