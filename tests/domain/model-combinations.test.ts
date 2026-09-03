import { describe, expect, it } from "vitest";
import { buildModelCombinations, modelCombinationsToDemandExpressions } from "../../src/domain/model-combinations.js";
import { parseModelCombination, parseModelCapability, parseModelRecord, type ModelCapability, type ModelRecord } from "../../src/types.js";

function capability(capabilityName: string, inputTypes: string[], outputTypes: string[], modelId: string): ModelCapability {
  return parseModelCapability({ id: `capability-${capabilityName}`, capability: capabilityName, modelIds: [modelId], sourceSignalIds: [`signal-${modelId}`], platforms: ["huggingface"], inputTypes, outputTypes, sourceQuotes: [capabilityName], sourceUrls: [`https://huggingface.co/${modelId}`], evidenceStatus: "verified" });
}

function model(modelId: string, capabilityName: string): ModelRecord {
  return parseModelRecord({ id: `huggingface:${modelId}`, platform: "huggingface", modelName: modelId, modelUrl: `https://huggingface.co/${modelId}`, inputTypes: [], outputTypes: [], claimedCapabilities: [capabilityName], tags: [], notes: [], sourceSignalId: `signal-${modelId}`, evidenceStatus: "verified" });
}

describe("model combination hypotheses", () => {
  it("generates only explicit compatible two-stage recipes", () => {
    const result = buildModelCombinations([
      capability("image-to-video", ["image"], ["video"], "acme/video"),
      capability("text-to-speech", ["text"], ["audio"], "acme/tts"),
      capability("lip-sync", ["video", "audio"], ["video"], "acme/lip"),
      capability("editable-svg", ["text"], ["svg"], "acme/svg"),
    ]);

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ combinedQuery: "product photo video with voiceover", capabilityChain: ["image-to-video", "text-to-speech"], evidenceStatus: "inferred" }),
      expect.objectContaining({ combinedQuery: "lip sync video generator", capabilityChain: ["image-to-video", "lip-sync"] }),
    ]));
    expect(result.every((item) => item.steps.length <= 2)).toBe(true);
    expect(result.some((item) => item.capabilityChain.includes("editable-svg"))).toBe(false);
  });

  it("deduplicates a capability chain and converts hypotheses to inferred demands", () => {
    const capabilities = [
      capability("image-to-video", ["image"], ["video"], "acme/video"),
      capability("text-to-speech", ["text"], ["audio"], "acme/tts"),
    ];
    const combinations = buildModelCombinations(capabilities);
    const duplicated = buildModelCombinations([...capabilities, ...capabilities]);
    expect(duplicated).toHaveLength(combinations.length);
    const expressions = modelCombinationsToDemandExpressions(combinations, [model("acme/video", "image-to-video"), model("acme/tts", "text-to-speech")]);
    expect(expressions[0]).toMatchObject({ text: "product photo video with voiceover", origin: "capability_derived", evidenceGrade: "inferred", evidencePrecision: "semantic", qualityState: "review", sourceEntityId: combinations[0]?.combinationId });
    expect(expressions[0]?.evidenceQuote).toMatch(/^组合假设：/u);
  });
});
