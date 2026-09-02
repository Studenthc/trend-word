import { describe, expect, it } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runRadar } from "../src/index.js";

describe("runRadar", () => {
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

  it("keeps the default radar on Product Hunt and GitHub entity content only", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "feedback-radar-pipeline-"));
    const requests: Array<{ url: string; body?: string }> = [];
    const transport = async (request: { url: string; body?: string }) => {
      requests.push(request);
      if (request.url.includes("/readme")) return { status: 200, headers: new Headers(), text: async () => JSON.stringify({ content: Buffer.from("A platform for building internal tools.").toString("base64"), encoding: "base64" }) };
      if (request.url.includes("graphql")) return { status: 200, headers: new Headers(), text: async () => JSON.stringify({ data: { post: { description: "A product for building AI applications.", tagline: "Build AI applications" } } }) };
      if (request.url.includes("/search/repositories")) return { status: 200, headers: new Headers(), text: async () => JSON.stringify({ items: [] }) };
      return { status: 200, headers: new Headers(), text: async () => JSON.stringify([]) };
    };
    const githubEntity = {
      id: "github-acme-flowpilot", sourceType: "github" as const, sourceName: "GitHub", sourceUrl: "https://github.com/acme/flowpilot", externalId: "acme/flowpilot", title: "acme/flowpilot", body: "Workflow automation", fetchedAt: "2026-09-01T00:00:00.000Z", sourceTier: "first_party" as const, sourceFingerprint: "github:acme/flowpilot", evidenceStatus: "verified" as const,
    };
    const productEntity = {
      id: "producthunt-ph-1", sourceType: "producthunt" as const, sourceName: "Product Hunt", sourceUrl: "https://www.producthunt.com/posts/flowpilot", externalId: "ph-1", title: "FlowPilot", excerpt: "A product for building AI applications.", fetchedAt: "2026-09-01T00:00:00.000Z", sourceTier: "market" as const, sourceFingerprint: "producthunt:ph-1", evidenceStatus: "verified" as const,
    };
    const result = await runRadar({
      date: "2026-09-01", workspaceRoot, sourceNames: ["producthunt", "github"], transports: { github: transport, producthunt: transport }, adapters: {
        github: { name: "github", collect: async () => ({ signals: [githubEntity], health: { sourceType: "github", status: "available", attemptedAt: "2026-09-01T00:00:00.000Z", itemCount: 1, failureReasons: [], coverageNotes: [] } }) },
        producthunt: { name: "producthunt", collect: async () => ({ signals: [productEntity], health: { sourceType: "producthunt", status: "available", attemptedAt: "2026-09-01T00:00:00.000Z", itemCount: 1, failureReasons: [], coverageNotes: [] } }) },
      },
    });
    expect(requests.some((request) => request.url.includes("/issues?"))).toBe(false);
    expect(requests.some((request) => request.body?.includes("comments"))).toBe(false);
    expect(result.report).toContain("产品能力推导");
    expect(result.report).not.toContain("反馈补全");
    const raw = (await readdir(path.join(workspaceRoot, "data", "runs", "2026-09-01"))).join(" ");
    expect(raw).toContain("raw-signals.jsonl");
  });
});
