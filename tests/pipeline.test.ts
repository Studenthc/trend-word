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

  it("adds GitHub feedback signals after entity discovery and reports both evidence tracks", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "feedback-radar-pipeline-"));
    const entity = {
      id: "github-acme-flowpilot", sourceType: "github" as const, sourceName: "GitHub", sourceUrl: "https://github.com/acme/flowpilot", externalId: "acme/flowpilot", title: "acme/flowpilot", body: "Workflow automation", fetchedAt: "2026-09-01T00:00:00.000Z", sourceTier: "first_party" as const, sourceFingerprint: "github:acme/flowpilot", evidenceStatus: "verified" as const,
    };
    const transport = async (request: { url: string }) => {
      if (request.url.includes("/readme")) return { status: 200, headers: new Headers(), text: async () => JSON.stringify({ content: Buffer.from("A platform for building internal tools.").toString("base64"), encoding: "base64" }) };
      return { status: 200, headers: new Headers(), text: async () => JSON.stringify([{ number: 12, title: "Looking for a Zapier alternative", body: "I need an alternative to Zapier.", html_url: "https://github.com/acme/flowpilot/issues/12", user: { id: 7, login: "user-a" }, created_at: "2026-09-01T00:00:00.000Z" }]) };
    };
    const result = await runRadar({
      date: "2026-09-01", workspaceRoot, sourceNames: ["github"], transports: { github: transport }, adapters: {
        github: { name: "github", collect: async () => ({ signals: [entity], health: { sourceType: "github", status: "available", attemptedAt: "2026-09-01T00:00:00.000Z", itemCount: 1, failureReasons: [], coverageNotes: [] } }) },
      },
    });
    expect(result.report).toContain("replace Zapier");
    expect(result.report).toContain("产品能力推导");
    expect(result.report).toContain("用户原话需求");
    expect(result.report).toContain("反馈补全：已获取 1 个反馈来源");
    const raw = (await readdir(path.join(workspaceRoot, "data", "runs", "2026-09-01"))).join(" ");
    expect(raw).toContain("raw-signals.jsonl");
  });
});
