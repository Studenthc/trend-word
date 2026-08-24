import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/cli.js";
import { runRadar } from "../src/index.js";
import { summarizeRun } from "../src/report/summary.js";
import { renderMarkdownReport } from "../src/report/markdown.js";
import { mergeExpressions } from "../src/domain/dedupe.js";
import { loadFixtureSignals } from "../src/sources/fixtures.js";
import { type HttpTransport as ProductHuntTransport } from "../src/sources/producthunt.js";
import { type HttpTransport as GitHubTransport } from "../src/sources/github.js";
import { type McpTransport } from "../src/sources/scys-mcp.js";
import { RunStore } from "../src/storage/run-store.js";
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
    expect(summary.failedSources).not.toContain("reddit-feed");
    expect(summary.partialSources).toContain("reddit-feed");
    expect(summary.warningCount).toBe(1);
    expect(summary.sourcesSucceeded).toEqual(["fixtures"]);
  });

  it("runs fixture corpus, groups source health, and persists all daily artifacts", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-report-"));
    const result = await runRadar({ date: "2026-08-24", sourceNames: ["fixtures"], workspaceRoot });
    expect(result.summary.date).toBe("2026-08-24");
    expect(result.summary.runStatus).toBe("complete");
    expect(result.summary.sourcesAttempted).toEqual(["fixtures"]);
    expect(result.summary.sourceHealth?.map((item) => item.sourceType)).toEqual(expect.arrayContaining(["scys-mcp", "producthunt", "github", "x-timeline", "reddit-feed"]));
    expect(result.report).toContain("## 来源健康");
    expect(result.report).toContain("scys-mcp: available");
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

  it("aggregates partial coverage and preserves missing historical lifecycle", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-partial-"));
    const fixtureSignals = await loadFixtureSignals();
    const historical = { ...mergeExpressions([{ ...fixtureSignals[0]!, title: "Historical only", id: "historical-only" }], [], { status: "available" })[0]!, lifecycle: "stable" as const };
    const store = new RunStore(workspaceRoot, "2026-08-24");
    await store.writeHistoryExpressions([historical]);
    const result = await runRadar({ date: "2026-08-24", sourceNames: ["fixtures"], workspaceRoot });
    const expression = result.summary.sourceHealth?.find((item) => item.status === "partial");
    const expressions = JSON.parse(await readFile(path.join(workspaceRoot, "data/runs/2026-08-24/expressions.json"), "utf8")) as Array<{ normalizedText: string; lifecycle: string }>;
    expect(expression?.status).toBe("partial");
    expect(expressions.find((item) => item.normalizedText === "historical only")?.lifecycle).toBe("stable");
  });

  it("does not append duplicate raw signals on an idempotent rerun", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-idempotent-"));
    await runRadar({ date: "2026-08-24", sourceNames: ["fixtures"], workspaceRoot });
    await runRadar({ date: "2026-08-24", sourceNames: ["fixtures"], workspaceRoot });
    const raw = (await readFile(path.join(workspaceRoot, "data/runs/2026-08-24/raw-signals.jsonl"), "utf8")).trim().split(/\r?\n/u);
    expect(raw).toHaveLength((await loadFixtureSignals()).length);
  });

  it("reports unimplemented requested sources and continues writing artifacts", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-unimplemented-"));
    const result = await runRadar({ date: "2026-08-24", sourceNames: ["github"], workspaceRoot });
    expect(result.summary.sourceHealth?.find((item) => item.sourceType === "github")?.status).toBe("unverified");
    await expect(readFile(result.paths.report, "utf8")).resolves.toContain("github");
  });

  it("runs injected stable sources through the source registry", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-injected-sources-"));
    const httpResponse = (body: unknown): Awaited<ReturnType<ProductHuntTransport>> => ({ status: 200, headers: new Headers(), text: async () => JSON.stringify(body) });
    const producthunt: ProductHuntTransport = async () => httpResponse({ posts: [] });
    const githubQueries: string[] = [];
    const github: GitHubTransport = async (request) => { const query = new URL(request.url).searchParams.get("q"); if (query) githubQueries.push(query); return httpResponse({ items: [] }); };
    const scysQueries: string[] = [];
    const scys: McpTransport = async (request) => { if (request.method === "content-search") scysQueries.push(String(request.params?.query)); return { items: [] }; };
    const result = await runRadar({ date: "2026-08-24", sourceNames: ["producthunt", "github", "scys-mcp"], workspaceRoot, transports: { producthunt, github, "scys-mcp": scys } });
    expect(result.summary.sourceHealth?.map((item) => item.status)).toEqual(["empty", "empty", "empty"]);
    expect(result.summary.sourceHealth?.map((item) => item.sourceType)).toEqual(["producthunt", "github", "scys-mcp"]);
    expect(githubQueries).toEqual(["ai tool", "mcp", "agent"]);
    expect(scysQueries).toEqual(["AI", "出海", "风向标"]);
  });

  it("keeps Task 9 sources explicit when requested", async () => {
    const result = await runRadar({ date: "2026-08-24", sourceNames: ["x-timeline"] });
    expect(result.summary.sourceHealth?.find((item) => item.sourceType === "x-timeline")).toMatchObject({ status: "unverified" });
  });

  it("keeps summary signal counts aligned with deduped persisted records", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-query-dedupe-"));
    const response = { status: 200, headers: new Headers(), text: async () => JSON.stringify({ items: [{ full_name: "acme/repeated", html_url: "https://github.com/acme/repeated", owner: { login: "acme" }, description: "Repeated" }] }) };
    const result = await runRadar({ date: "2026-08-24", sourceNames: ["github"], workspaceRoot, transports: { github: async () => response } });
    const rawLines = (await readFile(path.join(workspaceRoot, "data/runs/2026-08-24/raw-signals.jsonl"), "utf8")).trim().split(/\r?\n/u);
    const expressions = JSON.parse(await readFile(path.join(workspaceRoot, "data/runs/2026-08-24/expressions.json"), "utf8")) as unknown[];
    expect(result.summary.signalCount).toBe(1);
    expect(rawLines).toHaveLength(1);
    expect(expressions).toHaveLength(1);
  });

  it("marks a manual failed signal as unavailable coverage", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-manual-failed-"));
    const inputPath = path.join(workspaceRoot, "failed.jsonl");
    await writeFile(inputPath, `${JSON.stringify({ id: "failed", sourceUrl: "https://example.com/failed", title: "failed", sourceType: "manual", fetchedAt: "2026-08-24T00:00:00.000Z", evidenceStatus: "failed", failureReason: "HTTP 429" })}\n`);
    const result = await runRadar({ date: "2026-08-24", sourceNames: ["manual"], inputPath, workspaceRoot });
    expect(result.summary.sourceHealth?.find((item) => item.sourceType === "manual")?.status).toBe("unverified");
  });

  it("merges opportunity history across run dates without dropping old records", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-history-"));
    await runRadar({ date: "2026-08-24", sourceNames: ["fixtures"], workspaceRoot });
    const inputPath = path.join(workspaceRoot, "manual.jsonl");
    await writeFile(inputPath, `${JSON.stringify({ id: "manual-new", sourceUrl: "https://example.com/manual-new", sourceType: "manual", title: "Manual opportunity", fetchedAt: "2026-08-25T00:00:00.000Z" })}\n`);
    await runRadar({ date: "2026-08-25", sourceNames: ["manual"], inputPath, workspaceRoot });
    const history = JSON.parse(await readFile(path.join(workspaceRoot, "data/history/opportunities.json"), "utf8")) as Array<{ id: string }>;
    expect(history.some((item) => item.id === "opportunity-scys-wind-marker-1")).toBe(true);
    expect(history.some((item) => item.id === "opportunity-manual-new")).toBe(true);
  });

  it("finalizes a failed run summary when persistence fails", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-finalization-"));
    await mkdir(path.join(workspaceRoot, "data/history/opportunities.json"), { recursive: true });
    await expect(runRadar({ date: "2026-08-24", sourceNames: ["fixtures"], workspaceRoot })).rejects.toThrow();
    const summary = JSON.parse(await readFile(path.join(workspaceRoot, "data/runs/2026-08-24/run-summary.json"), "utf8")) as { runStatus: string; failureReason?: string };
    expect(summary.runStatus).toBe("failed");
    expect(summary.failureReason).toBeTruthy();
  });
});
