import { parseRawSignal, parseSourceHealth, type ModelRecord, type SourceAdapter, type SourceCollection, type SourceContext, type SourceHealth } from "../types.js";
import { createFalAiAdapter, type FalAiResult, type FalAiTransport } from "./fal-ai.js";
import { createHuggingFaceAdapter, type HuggingFaceResult, type HuggingFaceTransport } from "./huggingface.js";

export type ModelCatalogTransport = HuggingFaceTransport | FalAiTransport;
export type ModelCatalogTransports = { huggingface?: HuggingFaceTransport; falAi?: FalAiTransport };
export type ModelCatalogAdapterOptions = { recentDays?: number; limitPerPlatform?: number; platforms?: Array<"huggingface" | "fal-ai"> };

type PlatformResult = HuggingFaceResult | FalAiResult;

export function createModelCatalogAdapter(transports: ModelCatalogTransports, options: ModelCatalogAdapterOptions = {}): SourceAdapter {
  return {
    name: "model-catalog",
    async collect(context): Promise<SourceCollection> {
      const platforms = options.platforms ?? context.config.modelCatalog?.platforms ?? ["huggingface", "fal-ai"];
      const results: Array<{ platform: "huggingface" | "fal-ai"; result: PlatformResult }> = [];
      for (const platform of platforms) {
        const transport = platform === "huggingface" ? transports.huggingface : transports.falAi;
        const adapterOptions = { ...(options.recentDays !== undefined ? { recentDays: options.recentDays } : {}), ...(options.limitPerPlatform !== undefined ? { limit: options.limitPerPlatform } : {}) };
        const result = transport
          ? await (platform === "huggingface" ? createHuggingFaceAdapter(transport, adapterOptions).collect(context) : createFalAiAdapter(transport, adapterOptions).collect(context))
          : unavailablePlatform(platform, context.fetchedAt);
        results.push({ platform, result });
      }
      const modelRecords = results.flatMap(({ result }) => result.models);
      const signals = modelRecords.map((model) => toSignal(model, context.fetchedAt));
      const health = aggregateHealth(results, signals.length, context.fetchedAt);
      return { signals, modelRecords, health };
    },
  };
}

function toSignal(model: ModelRecord, fetchedAt: string): ReturnType<typeof parseRawSignal> {
  return parseRawSignal({
    id: model.sourceSignalId, sourceType: "model-catalog", sourceName: model.platform === "huggingface" ? "Hugging Face" : "fal.ai", sourceUrl: model.modelUrl,
    externalId: model.id, title: model.modelName, ...(model.description ? { body: model.description } : {}), excerpt: model.claimedCapabilities.join(", "),
    ...(model.updatedAt ?? model.createdAt ? { publishedAt: model.updatedAt ?? model.createdAt } : {}), fetchedAt, sourceTier: "first_party",
    ...(model.publicMetrics ? { engagement: { ...(model.publicMetrics.likes !== undefined ? { likes: model.publicMetrics.likes } : {}), ...(model.publicMetrics.downloads !== undefined ? { downloads: model.publicMetrics.downloads } : {}) } } : {}),
    tags: [`model-catalog:${model.platform}`, ...model.tags], signalKind: "entity", sourceFingerprint: `model-catalog:${model.id}`, evidenceStatus: model.evidenceStatus,
  });
}

function unavailablePlatform(platform: "huggingface" | "fal-ai", attemptedAt: string): PlatformResult {
  return {
    models: [],
    health: parseSourceHealth({ sourceType: "model-catalog", status: "unverified", attemptedAt, itemCount: 0, failureReasons: [`${platform}: transport not configured`], coverageNotes: [] }),
  };
}

function aggregateHealth(results: Array<{ platform: "huggingface" | "fal-ai"; result: PlatformResult }>, itemCount: number, attemptedAt: string): SourceHealth {
  const statuses = results.map(({ result }) => result.health.status);
  const hasModels = itemCount > 0;
  let status: SourceHealth["status"];
  if (hasModels) status = statuses.every((value) => value === "available") ? "available" : "partial";
  else if (statuses.every((value) => value === "empty")) status = "empty";
  else if (statuses.some((value) => value === "blocked")) status = "blocked";
  else if (statuses.some((value) => value === "partial")) status = "partial";
  else status = "unverified";
  return parseSourceHealth({
    sourceType: "model-catalog", status, attemptedAt, itemCount,
    failureReasons: results.flatMap(({ platform, result }) => result.health.failureReasons.map((reason) => `${platform}: ${reason}`)),
    coverageNotes: results.map(({ platform, result }) => `${platform}: ${result.health.status} (${result.models.length} models)`),
  });
}
