import { normalizeExpression } from "./normalize.js";
import type { DemandExpression, ModelCombination, ModelCapability, ModelRecord } from "../types.js";

type Recipe = { first: string; second: string; query: string; reason: string; notes: string[]; bridge: boolean };

const RECIPES: Recipe[] = [
  { first: "image-to-video", second: "text-to-speech", query: "product photo video with voiceover", reason: "video creation can be paired with a user-provided narration script", notes: ["the narration text is an explicit user input between stages"], bridge: true },
  { first: "image-to-video", second: "lip-sync", query: "lip sync video generator", reason: "generated video is a compatible video input for lip sync", notes: ["audio or script input is required by the second stage"], bridge: false },
  { first: "text-to-image", second: "image-to-video", query: "text to video from image", reason: "image output feeds image-to-video input", notes: ["the first stage must return an image"], bridge: false },
  { first: "speech-to-text", second: "translation", query: "speech translation", reason: "text output feeds text translation input", notes: ["language direction must be chosen by the user"], bridge: false },
];

export function buildModelCombinations(capabilities: ModelCapability[], limit = 20): ModelCombination[] {
  const byName = new Map<string, ModelCapability>();
  for (const capability of capabilities) {
    const existing = byName.get(capability.capability);
    if (!existing) byName.set(capability.capability, capability);
    else byName.set(capability.capability, mergeCapabilities(existing, capability));
  }
  const combinations: ModelCombination[] = [];
  for (const recipe of RECIPES) {
    const first = byName.get(recipe.first);
    const second = byName.get(recipe.second);
    if (!first || !second || (!recipe.bridge && !isCompatible(first, second))) continue;
    const capabilityChain = [first.capability, second.capability];
    combinations.push({
      combinationId: `combination-${normalizeExpression(capabilityChain.join(" ")).normalized}`,
      steps: [step(first), step(second)], capabilityChain, combinedQuery: recipe.query,
      candidateModels: [...new Set([...first.modelIds, ...second.modelIds])].sort(), compatibilityReason: recipe.reason,
      feasibilityNotes: recipe.notes, evidenceStatus: "inferred",
    });
    if (combinations.length >= limit) break;
  }
  return combinations;
}

export function modelCombinationsToDemandExpressions(combinations: ModelCombination[], models: ModelRecord[]): DemandExpression[] {
  return combinations.flatMap((combination, index) => {
    const selected = combination.candidateModels.map((id) => models.find((model) => model.id === id || model.id.endsWith(`:${id}`))).find((model): model is ModelRecord => Boolean(model));
    if (!selected) return [];
    const sourceText = `${combination.capabilityChain.join(" → ")}；${combination.compatibilityReason}`.slice(0, 2000);
    return [{
      id: `demand-model-combination-${normalizeExpression(combination.combinedQuery).normalized}-${index}`, text: combination.combinedQuery, normalizedText: normalizeExpression(combination.combinedQuery).normalized,
      type: "task" as const, rawSignalId: selected.sourceSignalId, sourceEntityId: combination.combinationId, sourceType: "model-catalog" as const, sourceUrl: selected.modelUrl,
      evidenceQuote: `组合假设：${sourceText}`.slice(0, 500), evidenceLocation: "metadata" as const, evidenceGrade: "inferred" as const, qualityState: "review" as const, qualityScore: 45,
      origin: "capability_derived" as const, sourceText, transformation: "将两个有明确输入输出关系的模型能力组合成任务型搜索假设；不是用户原话", evidencePrecision: "semantic" as const, firstSeenAt: selected.updatedAt ?? selected.createdAt ?? "unknown",
    } satisfies DemandExpression];
  });
}

function isCompatible(first: ModelCapability, second: ModelCapability): boolean {
  return first.outputTypes.some((output) => second.inputTypes.includes(output));
}
function step(capability: ModelCapability): ModelCombination["steps"][number] {
  return { modelIds: capability.modelIds, capability: capability.capability, inputTypes: capability.inputTypes, outputTypes: capability.outputTypes };
}
function mergeCapabilities(left: ModelCapability, right: ModelCapability): ModelCapability {
  return {
    ...left, modelIds: [...new Set([...left.modelIds, ...right.modelIds])].sort(), sourceSignalIds: [...new Set([...left.sourceSignalIds, ...right.sourceSignalIds])].sort(),
    platforms: [...new Set([...left.platforms, ...right.platforms])].sort(), inputTypes: [...new Set([...left.inputTypes, ...right.inputTypes])].sort(), outputTypes: [...new Set([...left.outputTypes, ...right.outputTypes])].sort(),
    sourceQuotes: [...new Set([...left.sourceQuotes, ...right.sourceQuotes])], sourceUrls: [...new Set([...left.sourceUrls, ...right.sourceUrls])].sort(), evidenceStatus: left.evidenceStatus === "verified" && right.evidenceStatus === "verified" ? "verified" : "partial",
  };
}
