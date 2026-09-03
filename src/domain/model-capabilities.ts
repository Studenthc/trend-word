import { normalizeExpression } from "./normalize.js";
import type { DemandExpression, KeywordModelMapping, ModelCapability, ModelRecord } from "../types.js";

export type ModelCapabilityRadar = { capabilities: ModelCapability[]; mappings: KeywordModelMapping[] };

const QUERY_BY_CAPABILITY: Record<string, string> = {
  "image-to-video": "image to video",
  "image-to-video-with-audio": "image to video with audio",
  "reference-to-video": "reference to video",
  "character-consistent-video": "character consistent video generator",
  "product-photo-to-video": "product photo to video",
  "first-last-frame-video": "first last frame video",
  "speech-to-text-translation": "speech to text translation",
  "lip-sync": "lip sync video generator",
  "accurate-text-rendering": "image generator with text",
  "example-based-image-editing": "example based image editing",
  "editable-svg": "editable svg generator",
  "local-inference": "local inference engine",
  "text-to-image": "text to image generator",
  "text-to-video": "text to video generator",
  "text-to-speech": "text to speech",
  "speech-to-text": "speech to text",
};

const CAPABILITY_ALIASES: Record<string, string> = {
  "image-to-video": "image-to-video", "image_to_video": "image-to-video", "image to video": "image-to-video",
  "image-to-video-with-audio": "image-to-video-with-audio", "image_to_video_with_audio": "image-to-video-with-audio",
  "reference-to-video": "reference-to-video", "character-consistent-video": "character-consistent-video",
  "product-photo-to-video": "product-photo-to-video", "first-last-frame-video": "first-last-frame-video",
  "speech-to-text-translation": "speech-to-text-translation", "lip-sync": "lip-sync", "lip sync": "lip-sync",
  "accurate-text-rendering": "accurate-text-rendering", "example-based-image-editing": "example-based-image-editing",
  "editable-svg": "editable-svg", "text-to-image": "text-to-image", "text-to-video": "text-to-video",
  "text-to-speech": "text-to-speech", "speech-to-text": "speech-to-text",
};

export function buildModelCapabilities(models: ModelRecord[]): ModelCapabilityRadar {
  const byCapability = new Map<string, { models: ModelRecord[] }>();
  for (const model of models) {
    for (const capability of detectCapabilities(model)) {
      const group = byCapability.get(capability) ?? { models: [] };
      group.models.push(model);
      byCapability.set(capability, group);
    }
  }
  const capabilities = [...byCapability.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([capability, group]) => toCapability(capability, group.models));
  const mappings = capabilities.flatMap(toMapping);
  return { capabilities, mappings };
}

export function modelMappingsToDemandExpressions(mappings: KeywordModelMapping[], models: ModelRecord[]): DemandExpression[] {
  const modelById = new Map(models.map((model) => [model.id, model]));
  return mappings.flatMap((mapping, index) => {
    const model = mapping.modelIds.map((id) => modelById.get(id)).find((item): item is ModelRecord => Boolean(item));
    if (!model) return [];
    const firstSeenAt = model.updatedAt ?? model.createdAt ?? "unknown";
    const quote = `模型目录能力：${mapping.originalText}`.slice(0, 500);
    return [{
      id: `demand-model-${mapping.normalizedKeyword}-${index}`, text: mapping.keyword, normalizedText: mapping.normalizedKeyword, type: "task" as const,
      rawSignalId: model.sourceSignalId, sourceEntityId: mapping.id, sourceType: "model-catalog" as const, sourceUrl: model.modelUrl,
      evidenceQuote: quote, evidenceLocation: "metadata" as const, evidenceGrade: "inferred" as const, qualityState: "review" as const, qualityScore: 55,
      origin: "capability_derived" as const, sourceText: mapping.originalText.slice(0, 2000), transformation: mapping.transformation, evidencePrecision: "semantic" as const, firstSeenAt,
    } satisfies DemandExpression];
  });
}

function detectCapabilities(model: ModelRecord): string[] {
  const values = [...model.claimedCapabilities, ...model.tags, ...model.inputTypes, ...model.outputTypes, model.description ?? ""];
  const normalizedValues = values.map(normalizeLabel);
  const text = normalizedValues.join(" ");
  const found = new Set<string>();
  for (const value of normalizedValues) {
    const alias = CAPABILITY_ALIASES[value];
    if (alias) found.add(alias);
  }
  if (/image-to-video-with-audio|video.*audio.*image/iu.test(text)) found.add("image-to-video-with-audio");
  if (/reference-to-video|reference.*video/iu.test(text)) found.add("reference-to-video");
  if (/character-consisten|consistent-character/iu.test(text)) found.add("character-consistent-video");
  if (/product-photo.*video|product.*photo.*video/iu.test(text)) found.add("product-photo-to-video");
  if (/first-last-frame|first.*last.*frame/iu.test(text)) found.add("first-last-frame-video");
  if (/speech-to-text.*translation|speech.*translation/iu.test(text)) found.add("speech-to-text-translation");
  if (/accurate-text|text-rendering|render.*text/iu.test(text)) found.add("accurate-text-rendering");
  if (/example-based.*image|image.*example.*edit/iu.test(text)) found.add("example-based-image-editing");
  if (/editable-svg|svg.*edit/iu.test(text)) found.add("editable-svg");
  if (/gguf|llama\.cpp|local-inference|local.*inference|on-device|local\s+model/iu.test(text)) found.add("local-inference");
  if (model.inputTypes.includes("text") && model.outputTypes.includes("image")) found.add("text-to-image");
  if (model.inputTypes.includes("text") && model.outputTypes.includes("video")) found.add("text-to-video");
  if (model.inputTypes.includes("text") && model.outputTypes.includes("audio")) found.add("text-to-speech");
  if (model.inputTypes.includes("audio") && model.outputTypes.includes("text")) found.add("speech-to-text");
  return [...found].filter((capability) => capability in QUERY_BY_CAPABILITY).sort();
}

function toCapability(capability: string, models: ModelRecord[]): ModelCapability {
  const uniqueModels = uniqueById(models);
  const statuses = uniqueModels.map((model) => model.evidenceStatus);
  return {
    id: `capability-${capability}`,
    capability,
    modelIds: uniqueModels.map((model) => model.id).sort(),
    sourceSignalIds: uniqueModels.map((model) => model.sourceSignalId).sort(),
    platforms: [...new Set(uniqueModels.map((model) => model.platform))].sort(),
    inputTypes: [...new Set(uniqueModels.flatMap((model) => model.inputTypes))].sort(),
    outputTypes: [...new Set(uniqueModels.flatMap((model) => model.outputTypes))].sort(),
    sourceQuotes: uniqueModels.flatMap((model) => [model.description, model.claimedCapabilities.join(", ")].filter((quote): quote is string => Boolean(quote?.trim()))).map((quote) => quote.slice(0, 500)),
    sourceUrls: uniqueModels.map((model) => model.modelUrl).sort(),
    evidenceStatus: statuses.every((status) => status === "verified") ? "verified" : statuses.length > 0 ? "partial" : "unverified",
  };
}

function toMapping(capability: ModelCapability): KeywordModelMapping[] {
  const keyword = QUERY_BY_CAPABILITY[capability.capability];
  if (!keyword) return [];
  return [{
    id: `keyword-model-${normalizeExpression(keyword).normalized}`,
    keyword, normalizedKeyword: normalizeExpression(keyword).normalized, capabilityId: capability.id, modelIds: capability.modelIds,
    sourceSignalIds: capability.sourceSignalIds,
    sourceUrls: capability.sourceUrls, originalText: capability.sourceQuotes.join(" | ").slice(0, 2000),
    transformation: `从模型目录的 ${capability.capability} 能力压缩为任务型搜索表达；模型名不作为需求词`, origin: "capability_derived", qualityState: "review", evidenceStatus: "inferred",
  }];
}

function normalizeLabel(value: string): string { return value.trim().toLocaleLowerCase("en-US").replace(/[_/]+/gu, "-").replace(/\s+/gu, " ").replace(/\s*-\s*/gu, "-"); }
function uniqueById(models: ModelRecord[]): ModelRecord[] { return [...new Map(models.map((model) => [model.id, model])).values()]; }
