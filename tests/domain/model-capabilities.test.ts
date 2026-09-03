import { describe, expect, it } from "vitest";
import { buildModelCapabilities, modelCapabilitySummary, modelMappingsToDemandExpressions } from "../../src/domain/model-capabilities.js";
import { parseModelRecord, type ModelRecord } from "../../src/types.js";

function model(overrides: Partial<ModelRecord>): ModelRecord {
  return parseModelRecord({
    id: "huggingface:acme/base", platform: "huggingface", modelName: "acme/base", modelUrl: "https://huggingface.co/acme/base",
    inputTypes: [], outputTypes: [], claimedCapabilities: [], tags: [], notes: [], sourceSignalId: "signal-base", evidenceStatus: "verified", ...overrides,
  });
}

describe("model capability normalization", () => {
  it("normalizes concrete capabilities and never uses opaque model names as queries", () => {
    const result = buildModelCapabilities([
      model({ id: "huggingface:acme/image", modelName: "acme/awesome-v2", modelUrl: "https://huggingface.co/acme/image", sourceSignalId: "signal-image", inputTypes: ["image"], outputTypes: ["video"], claimedCapabilities: ["image-to-video"], tags: ["image_to_video"] }),
      model({ id: "fal-ai/acme/lip", platform: "fal-ai", modelName: "acme/lip", modelUrl: "https://fal.ai/models/acme/lip/lip-sync", sourceSignalId: "signal-lip", inputTypes: ["video", "audio"], outputTypes: ["video"], claimedCapabilities: ["lip-sync"], tags: ["lip sync"] }),
      model({ id: "huggingface:acme/local", modelName: "acme/local-v1", modelUrl: "https://huggingface.co/acme/local-v1", sourceSignalId: "signal-local", claimedCapabilities: ["GGUF"], tags: ["local", "llama.cpp"] }),
      model({ id: "huggingface:acme/generic", modelName: "acme/generic", modelUrl: "https://huggingface.co/acme/generic", sourceSignalId: "signal-generic", claimedCapabilities: ["AI generation", "multimodal", "platform"] }),
    ]);

    expect(result.capabilities.map((item) => item.capability)).toEqual(expect.arrayContaining(["image-to-video", "lip-sync", "local-inference"]));
    expect(result.mappings.map((item) => item.keyword)).toEqual(expect.arrayContaining(["image to video", "lip sync video generator", "local inference engine"]));
    expect(result.mappings.some((item) => item.keyword.includes("awesome"))).toBe(false);
    expect(result.mappings.some((item) => item.keyword === "AI generation" || item.keyword === "multimodal")).toBe(false);
    for (const mapping of result.mappings) expect(mapping.sourceUrls.length).toBeGreaterThan(0);
  });

  it("merges equivalent capability spellings and preserves derived provenance", () => {
    const result = buildModelCapabilities([
      model({ id: "huggingface:one", modelName: "acme/one", modelUrl: "https://huggingface.co/acme/one", sourceSignalId: "signal-one", claimedCapabilities: ["image-to-video"] }),
      model({ id: "huggingface:two", modelName: "acme/two", modelUrl: "https://huggingface.co/acme/two", sourceSignalId: "signal-two", claimedCapabilities: ["image to video"] }),
    ]);

    const mappings = result.mappings.filter((item) => item.keyword === "image to video");
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({ origin: "capability_derived", qualityState: "review", evidenceStatus: "inferred", modelIds: ["huggingface:one", "huggingface:two"], sourceSignalIds: ["signal-one", "signal-two"] });
  });

  it("converts mappings to bounded demand expressions with original evidence", () => {
    const records = [model({ id: "huggingface:image", modelName: "acme/image", modelUrl: "https://huggingface.co/acme/image", sourceSignalId: "signal-image", claimedCapabilities: ["image-to-video"] })];
    const result = buildModelCapabilities(records);
    const expressions = modelMappingsToDemandExpressions(result.mappings, records);

    expect(expressions).toEqual(expect.arrayContaining([expect.objectContaining({ text: "image to video", rawSignalId: "signal-image", sourceEntityId: result.mappings[0]?.id, origin: "capability_derived", evidenceGrade: "inferred", qualityState: "review", evidencePrecision: "semantic" })]));
    expect(expressions[0]?.sourceText).toContain("image-to-video");
  });

  it("provides a human-readable capability summary alongside the Trends query", () => {
    expect(modelCapabilitySummary("multi-reference-image-editing")).toBe("同时使用多张参考图进行图片编辑");
    const records = [model({ id: "huggingface:summary", modelName: "acme/summary", modelUrl: "https://huggingface.co/acme/summary", sourceSignalId: "signal-summary", claimedCapabilities: ["multi-reference-image-editing"] })];
    const radar = buildModelCapabilities(records);
    const expressions = modelMappingsToDemandExpressions(radar.mappings, records);

    const expression = expressions.find((item) => item.text === "multi reference image editing");
    expect(expression?.evidenceQuote).toContain("能力总结：同时使用多张参考图进行图片编辑");
    expect(expression?.transformation).toContain("能力总结");
  });

  it("recovers concrete capabilities from catalog descriptions and labels", () => {
    const result = buildModelCapabilities([
      model({ id: "fal-ai:seedream-edit", modelName: "fal/seedream-edit", modelUrl: "https://fal.ai/models/fal/seedream-edit", sourceSignalId: "signal-seedream", description: "Region-precise image editing changes one element while keeping the rest of the frame intact with layer separation and up to 10 reference images.", claimedCapabilities: ["edit"] }),
      model({ id: "fal-ai:gpt-image", modelName: "fal/gpt-image", modelUrl: "https://fal.ai/models/fal/gpt-image", sourceSignalId: "signal-gpt-image", description: "Creates extremely detailed images with fine typography.", claimedCapabilities: ["gpt-image-2"] }),
      model({ id: "fal-ai:birefnet", modelName: "fal/birefnet", modelUrl: "https://fal.ai/models/fal/birefnet", sourceSignalId: "signal-birefnet", description: "High-resolution image segmentation for dichotomous image segmentation.", claimedCapabilities: ["v2"] }),
      model({ id: "huggingface:deepfake", modelName: "hf/deepfake", modelUrl: "https://huggingface.co/hf/deepfake", sourceSignalId: "signal-deepfake", claimedCapabilities: ["deepfake-detection"] }),
    ]);

    expect(result.mappings.map((item) => item.keyword)).toEqual(expect.arrayContaining([
      "region specific image editing",
      "multi reference image editing",
      "layer aware image editing",
      "image generator with text",
      "image segmentation",
      "deepfake detection",
    ]));
    expect(result.mappings.some((item) => item.keyword === "edit" || item.keyword === "v2")).toBe(false);
  });
});
