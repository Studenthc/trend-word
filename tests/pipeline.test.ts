import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runRadar } from "../src/index.js";
import { parseModelRecord, parseRawSignal, parseSourceHealth } from "../src/types.js";

describe("runRadar", () => {
  it("persists model artifacts and keeps model-only demand in observation", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "model-radar-pipeline-"));
    const model = parseModelRecord({ id: "huggingface:acme/image-to-video", platform: "huggingface", modelName: "acme/image-to-video", modelUrl: "https://huggingface.co/acme/image-to-video", updatedAt: "2026-09-02T00:00:00.000Z", inputTypes: ["image"], outputTypes: ["video"], claimedCapabilities: ["image-to-video"], tags: ["image-to-video"], notes: [], sourceSignalId: "model-signal", evidenceStatus: "verified" });
    const adapter = { name: "model-catalog" as const, collect: async () => ({ signals: [parseRawSignal({ id: "model-signal", sourceType: "model-catalog", sourceName: "Hugging Face", sourceUrl: model.modelUrl, externalId: model.id, title: model.modelName, body: "image-to-video", excerpt: "image-to-video", publishedAt: model.updatedAt, fetchedAt: "2026-09-03T00:00:00.000Z", sourceTier: "first_party", tags: ["model-catalog:huggingface"], signalKind: "entity", sourceFingerprint: "model-signal", evidenceStatus: "verified" })], modelRecords: [model], health: parseSourceHealth({ sourceType: "model-catalog", status: "available", attemptedAt: "2026-09-03T00:00:00.000Z", itemCount: 1, failureReasons: [], coverageNotes: [] }) }) };
    const result = await runRadar({ date: "2026-09-03", sourceNames: ["model-catalog"], workspaceRoot, adapters: { "model-catalog": adapter } });
    const runDirectory = path.join(workspaceRoot, "data", "runs", "2026-09-03");

    expect(result.summary.sourceHealth?.map((item) => item.sourceType)).toContain("model-catalog");
    expect(JSON.parse(await readFile(path.join(runDirectory, "model-inventory.json"), "utf8"))).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(runDirectory, "capabilities.json"), "utf8"))).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(runDirectory, "keyword-model-mapping.json"), "utf8"))).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(runDirectory, "model-combinations.json"), "utf8"))).toEqual([]);
    expect(result.summary).toMatchObject({ modelInventoryCount: 1, capabilityCount: 1, modelKeywordCount: 1, modelWatchDemandCount: 1, modelFormalDemandCount: 0 });
    expect(result.candidates?.formal.some((item) => item.sourceType === "model-catalog")).toBe(false);
    expect(result.candidates?.backup.some((item) => item.evidenceOrigin === "capability_derived")).toBe(true);
    expect(result.report).toContain("模型能力雷达");
  });
  it("returns a run summary and report projection for fixture input", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "seed-radar-"));
    const result = await runRadar({ date: "2026-08-24", sourceNames: ["fixtures"], workspaceRoot });
    expect(result.summary.date).toBe("2026-08-24");
    expect(result.summary.sourcesAttempted).toContain("fixtures");
    expect(result.report).toContain("新词机会雷达");
    expect(await readdir(path.join(workspaceRoot, "data", "runs", "2026-08-24"))).toEqual(expect.arrayContaining(["seed-terms.json", "expression-clusters.json", "demand-expressions.json", "candidates.json"]));
    expect(result.report).toContain("需求抽取漏斗");
    expect(result.report).toContain("需求表达 1");
    expect(result.report).toContain("automating repetitive workflows");
  });
});
