import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/cli.js";
import { runRadar } from "../src/index.js";
import { summarizeRun } from "../src/report/summary.js";
import { renderMarkdownReport } from "../src/report/markdown.js";
import type { Evidence, Opportunity, RawSignal, SourceHealth } from "../src/types.js";

function signal(id: string, sourceType: RawSignal["sourceType"] = "fixtures", status: RawSignal["evidenceStatus"] = "verified"): RawSignal {
  return {
    id, sourceType, sourceName: sourceType, sourceUrl: `https://example.com/${id}`, title: id,
    fetchedAt: "2026-08-24T00:00:00.000Z", sourceTier: "community", sourceFingerprint: id,
    evidenceStatus: status, ...(status === "failed" ? { failureReason: "HTTP 429" } : {}),
  };
}

function evidence(id: string, rawSignalId: string, grade: Evidence["evidenceGrade"]): Evidence {
  return { id, subjectId: "expression-test", claimType: "adoption", rawSignalId, quote: "Original quote", location: "body", capturedAt: "2026-08-24T00:00:00.000Z", evidenceGrade: grade };
}

function opportunity(id: string, status: Opportunity["status"]): Opportunity {
  return {
    id, primaryExpressionId: "expression-test", title: id, summary: "summary", audiences: ["builders"], userProblems: ["problem"],
    recommendedArtifact: "tool", evidenceIds: [], validation: { freshness: "unknown", trend: "unknown", intent: "unknown", demand: "single_signal", competition: "unknown", monetization: "unknown", delivery: "unknown", confidence: "low", missingChecks: [] },
    riskFlags: [], status, createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z",
  };
}

describe("daily radar report", () => {
  it("renders required health, opportunity, evidence, risk, and coverage sections", () => {
    const health: SourceHealth[] = [
      { sourceType: "fixtures", status: "available", attemptedAt: "2026-08-24T00:00:00.000Z", itemCount: 2, failureReasons: [], coverageNotes: ["fixture coverage"] },
      { sourceType: "reddit-feed", status: "partial", attemptedAt: "2026-08-24T00:00:00.000Z", itemCount: 0, failureReasons: ["HTTP 429"], coverageNotes: ["coverage unavailable"] },
    ];
    const signals = [signal("one"), signal("failed", "reddit-feed", "failed")];
    const opportunities = [opportunity("action", "actionable"), opportunity("validating", "validating"), opportunity("watch", "watch"), opportunity("new", "new")];
    const summary = summarizeRun({ date: "2026-08-24", sourceHealth: health, signals, expressions: [], evidence: [evidence("direct", "one", "direct"), evidence("inferred", "one", "inferred")], opportunities });
    const report = renderMarkdownReport({ summary, sourceHealth: health, signals, expressions: [], evidence: [evidence("direct", "one", "direct")], opportunities });
    expect(report).toContain("## 来源健康");
    expect(report).toContain("## 今日可行动机会");
    expect(report).toContain("## 正在验证");
    expect(report).toContain("## 新发现但证据不足");
    expect(report).toContain("## 风险与失败");
    expect(report).toContain("原文证据");
    expect(report).toContain("覆盖范围");
    expect(summary.evidenceGradeCounts?.direct).toBe(1);
    expect(summary.evidenceGradeCounts?.inferred).toBe(1);
    expect(summary.candidateStatusCounts?.actionable).toBe(1);
    expect(summary.failedSources).toContain("reddit-feed");
    expect(summary.partialSources).toContain("reddit-feed");
  });

  it("runs fixture corpus, groups source health, and persists all daily artifacts", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-report-"));
    const result = await runRadar({ date: "2026-08-24", sourceNames: ["fixtures"], workspaceRoot });
    expect(result.summary.date).toBe("2026-08-24");
    expect(result.summary.sourcesAttempted).toEqual(["fixtures"]);
    expect(result.summary.sourceHealth?.map((item) => item.sourceType)).toEqual(expect.arrayContaining(["scys-mcp", "producthunt", "github", "x-timeline", "reddit-feed"]));
    expect(result.report).toContain("## 来源健康");
    expect(result.paths.report).toContain("data/runs/2026-08-24");
    for (const file of ["raw-signals.jsonl", "expressions.json", "evidence.json", "opportunities.json", "run-summary.json", "report.md"]) {
      await expect(readFile(path.join(workspaceRoot, "data", "runs", "2026-08-24", file), "utf8")).resolves.toBeTruthy();
    }
  });

  it("parses supported CLI flags and rejects unknown flags", () => {
    expect(parseCliArgs(["--date", "2026-08-24", "--sources", "fixtures,manual", "--input", "input.jsonl", "--workspace", "/tmp/radar"]))
      .toEqual({ date: "2026-08-24", sourceNames: ["fixtures", "manual"], inputPath: "input.jsonl", workspaceRoot: "/tmp/radar" });
    expect(parseCliArgs(["--", "--date", "2026-08-24"])).toEqual({ date: "2026-08-24" });
    expect(() => parseCliArgs(["--unknown"])).toThrow(/usage/i);
  });

  it("persists a failed run summary for invalid manual configuration", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-config-error-"));
    await expect(runRadar({ date: "2026-08-24", sourceNames: ["manual"], workspaceRoot })).rejects.toThrow(/requires --input/);
    const summary = JSON.parse(await readFile(path.join(workspaceRoot, "data/runs/2026-08-24/run-summary.json"), "utf8")) as { sourceHealth: SourceHealth[] };
    expect(summary.sourceHealth[0]?.status).toBe("blocked");
  });
});
