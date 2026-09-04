import { normalizeExpression } from "./normalize.js";
import type { DemandExpression, KeywordModelMapping, ModelCapability, ModelRecord } from "../types.js";

export type ModelCapabilityRadar = { capabilities: ModelCapability[]; mappings: KeywordModelMapping[] };

const BASELINE_MODEL_QUERIES = new Set([
  "image editing",
  "image segmentation",
  "image style transfer",
  "image to video",
  "local inference engine",
  "speech to text",
  "text to image generator",
  "text to speech",
  "text translation",
  "text to video generator",
]);

const CAPABILITY_SUMMARIES: Record<string, string> = {
  "image-to-video": "根据图片生成视频",
  "image-to-video-with-audio": "根据图片生成带音频的视频",
  "reference-to-video": "根据参考图或参考内容生成视频",
  "character-consistent-video": "让视频中的角色保持一致",
  "product-photo-to-video": "把商品图转成展示视频",
  "first-last-frame-video": "用首尾帧控制视频生成",
  "speech-to-text-translation": "把语音识别并翻译成目标语言",
  "lip-sync": "让视频人物口型匹配音频",
  "accurate-text-rendering": "生成带准确文字的图片",
  "example-based-image-editing": "用示例图指导图片编辑",
  "editable-svg": "生成可编辑的 SVG",
  "local-inference": "在本地设备运行模型推理",
  "text-to-image": "根据文字生成图片",
  "text-to-video": "根据文字生成视频",
  "text-to-speech": "把文字转换为语音",
  "speech-to-text": "把语音转换为文字",
  translation: "把文本翻译成目标语言",
  "image-editing": "编辑图片中的指定内容",
  "region-specific-image-editing": "只替换图片中的指定区域或元素，其他画面保持不变",
  "multi-reference-image-editing": "用多张参考图同时约束图片编辑结果",
  "layer-aware-image-editing": "把图片拆成可分别编辑的图层",
  "sequential-image-editing": "连续多轮编辑同一张图并保持主体一致",
  "image-style-transfer": "把参考风格迁移到目标图片",
  "text-rendering": "生成带可读文字的图片",
  "image-segmentation": "把图片中的主体与背景分离",
  "image-classification": "识别并分类图片内容",
  "deepfake-detection": "检测图片或视频是否为深度伪造",
};

export function modelCapabilitySummary(capability: string): string {
  return CAPABILITY_SUMMARIES[capability] ?? capability.replace(/[-_]+/gu, " ");
}

export function isBaselineModelQuery(value: string): boolean {
  return BASELINE_MODEL_QUERIES.has(normalizeExpression(value).normalized);
}

const CONCRETE_QUERY_MARKERS = ["product", "photo", "region", "multi", "reference", "layer", "layers", "sequential", "style", "typography", "text", "deepfake", "local", "voiceover", "object", "replacement", "consistent", "accurate", "editor"];

export function modelQueryPriority(value: string): number {
  const normalized = normalizeExpression(value).normalized;
  if (!normalized) return 0;
  const markerScore = CONCRETE_QUERY_MARKERS.filter((marker) => normalized.includes(marker)).length * 6;
  const combinationScore = /(?:voiceover|from image|speech translation)/iu.test(normalized) ? 40 : 0;
  return combinationScore + Math.min(markerScore, 30);
}

const QUERY_BY_CAPABILITY: Record<string, string> = {
  "image-to-video": "image to video",
  "image-editing": "image editing",
  "region-specific-image-editing": "AI object replacement",
  "multi-reference-image-editing": "AI image editor with reference images",
  "layer-aware-image-editing": "AI image editor with layers",
  "sequential-image-editing": "consistent image editing",
  "image-style-transfer": "image style transfer",
  "text-rendering": "AI image generator with accurate text",
  "image-segmentation": "image segmentation",
  "image-classification": "image classification",
  "deepfake-detection": "deepfake detection",
  "image-to-video-with-audio": "image to video with audio",
  "reference-to-video": "reference image to video",
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
  translation: "text translation",
};

const QUERY_VARIANTS_BY_CAPABILITY: Record<string, string[]> = {
  "region-specific-image-editing": ["region specific image editing", "replace object in image"],
  "multi-reference-image-editing": ["multi reference image editing", "image editor with reference images"],
  "layer-aware-image-editing": ["layer aware image editing", "image editing with layers"],
  "sequential-image-editing": ["sequential image editing", "multi turn image editing"],
  "text-rendering": ["image generator with text", "accurate text image generator"],
  "reference-to-video": ["reference to video", "image to video from reference image"],
};

const CAPABILITY_ALIASES: Record<string, string> = {
  "image-to-video": "image-to-video", "image_to_video": "image-to-video", "image to video": "image-to-video",
  "image-editing": "image-editing", "image editing": "image-editing",
  "region-specific-image-editing": "region-specific-image-editing", "region-precise-image-editing": "region-specific-image-editing",
  "multi-reference-image-editing": "multi-reference-image-editing", "multi reference image editing": "multi-reference-image-editing",
  "layer-aware-image-editing": "layer-aware-image-editing", "layer aware image editing": "layer-aware-image-editing",
  "sequential-image-editing": "sequential-image-editing", "sequential image editing": "sequential-image-editing",
  "image-style-transfer": "image-style-transfer", "style-transfer": "image-style-transfer", "style transfer": "image-style-transfer",
  "text-rendering": "text-rendering", "text rendering": "text-rendering",
  "image-segmentation": "image-segmentation", "semantic-segmentation": "image-segmentation",
  "image-classification": "image-classification", "deepfake-detection": "deepfake-detection",
  "image-to-video-with-audio": "image-to-video-with-audio", "image_to_video_with_audio": "image-to-video-with-audio",
  "reference-to-video": "reference-to-video", "character-consistent-video": "character-consistent-video",
  "product-photo-to-video": "product-photo-to-video", "first-last-frame-video": "first-last-frame-video",
  "speech-to-text-translation": "speech-to-text-translation", "lip-sync": "lip-sync", "lip sync": "lip-sync",
  "accurate-text-rendering": "accurate-text-rendering", "example-based-image-editing": "example-based-image-editing",
  "editable-svg": "editable-svg", "text-to-image": "text-to-image", "text-to-video": "text-to-video",
  "text-to-speech": "text-to-speech", "speech-to-text": "speech-to-text", translation: "translation",
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
    const capability = mapping.capabilityId.replace(/^capability-/u, "");
    const summary = modelCapabilitySummary(capability);
    const quote = `能力总结：${summary}；模型目录依据：${mapping.originalText}`.slice(0, 500);
    return [{
      id: `demand-model-${mapping.normalizedKeyword}-${index}`, text: mapping.keyword, normalizedText: mapping.normalizedKeyword, type: "task" as const,
      rawSignalId: model.sourceSignalId, sourceEntityId: mapping.id, sourceType: "model-catalog" as const, sourceUrl: model.modelUrl,
      evidenceQuote: quote, evidenceLocation: "metadata" as const, evidenceGrade: "inferred" as const, qualityState: "review" as const, qualityScore: 55,
      origin: "capability_derived" as const, sourceText: mapping.originalText.slice(0, 2000), transformation: `${mapping.transformation}；能力总结：${summary}`, evidencePrecision: "semantic" as const, ...(mapping.queryVariants ? { queryVariants: mapping.queryVariants } : {}), firstSeenAt,
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
  if (/image.*editing|editing.*images?/iu.test(text)) found.add("image-editing");
  if (/region[- ](?:precise|specific)|change[sd]?\s+one\s+element|keep(?:ing)?\s+the\s+rest/iu.test(text)) found.add("region-specific-image-editing");
  if (/(?:multi(?:ple)?|up\s+to\s+\d+)\s+reference\s+images?|reference\s+images?/iu.test(text)) found.add("multi-reference-image-editing");
  if (/layer[- ](?:separation|aware)|separate\s+layers/iu.test(text)) found.add("layer-aware-image-editing");
  if (/sequential(?:\s+image)?\s+editing/iu.test(text)) found.add("sequential-image-editing");
  if (/style\s+transfer/iu.test(text)) found.add("image-style-transfer");
  if (/fine\s+typography|text[- ]rendering|accurate\s+text|typography/iu.test(text)) found.add("text-rendering");
  if (/image\s+segmentation|semantic\s+segmentation|dichotomous\s+image/iu.test(text)) found.add("image-segmentation");
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
  if (/generat(?:e|es|ing)\s+[^.]{0,80}(?:images?|photos?)\s+from\s+text/iu.test(text)) found.add("text-to-image");
  if (/deepfake[- ]detection/iu.test(text)) found.add("deepfake-detection");
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
    transformation: `从模型目录的 ${capability.capability} 能力压缩为自然任务型搜索表达；模型名不作为需求词`, origin: "capability_derived", qualityState: "review", evidenceStatus: "inferred",
    ...(QUERY_VARIANTS_BY_CAPABILITY[capability.capability] ? { queryVariants: QUERY_VARIANTS_BY_CAPABILITY[capability.capability] } : {}),
  }];
}

function normalizeLabel(value: string): string { return value.trim().toLocaleLowerCase("en-US").replace(/[_/]+/gu, "-").replace(/\s+/gu, " ").replace(/\s*-\s*/gu, "-"); }
function uniqueById(models: ModelRecord[]): ModelRecord[] { return [...new Map(models.map((model) => [model.id, model])).values()]; }
