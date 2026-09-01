import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseCliArgs } from "../src/cli.js";
import { runRadar } from "../src/index.js";
import { summarizeRun } from "../src/report/summary.js";
import { renderMarkdownReport } from "../src/report/markdown.js";
import { main } from "../src/cli.js";
import { mergeExpressions } from "../src/domain/dedupe.js";
import { loadFixtureSignals } from "../src/sources/fixtures.js";
import { type HttpTransport as ProductHuntTransport } from "../src/sources/producthunt.js";
import { type HttpTransport as GitHubTransport } from "../src/sources/github.js";
import { type McpTransport } from "../src/sources/scys-mcp.js";
import type { CandidateQueue } from "../src/domain/candidates.js";
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
  it("renders only the bounded Google Trends verification pool", () => {
    const candidates: CandidateQueue = {
      formal: [{ candidateId: "candidate-ai", term: "AI短剧带货", sourceType: "scys-mcp", context: "正文提到“AI短剧带货”", reason: "正文出现了具体表达", lane: "formal", sourceSignalId: "one", sourceUrl: "https://example.com/one", authorName: "作者", publishedAt: "2026-08-25T00:00:00.000Z", trendsUrl: "https://trends.google.com/trends/explore?date=now%207-d&q=AI", score: 90, missingFields: [], evidenceOrigin: "user_evidence" }, { candidateId: "candidate-demand-capability-derived", term: "AI photo generator", sourceType: "producthunt", context: "A product can generate AI photos", reason: "产品能力可转成搜索词", lane: "formal", sourceSignalId: "two", sourceUrl: "https://example.com/two", trendsUrl: "https://trends.google.com/trends/explore?q=AI", score: 80, missingFields: ["用户原话/替代诉求待确认"], evidenceOrigin: "capability_derived" }],
      backup: [{ candidateId: "candidate-title", term: "标题线索", sourceType: "scys-mcp", context: "标题线索", reason: "当前只有标题", lane: "backup", sourceSignalId: "two", sourceUrl: "https://example.com/two", trendsUrl: "https://trends.google.com/trends/explore?date=now%207-d&q=title", score: 10, missingFields: ["正文上下文"] }],
    };
    const report = renderMarkdownReport({ summary: { date: "2026-08-24", sourceHealth: [], sourcesAttempted: ["scys-mcp"] }, sourceHealth: [{ sourceType: "scys-mcp", status: "available", attemptedAt: "2026-08-24T00:00:00.000Z", itemCount: 0, failureReasons: [], coverageNotes: [] }], signals: [], expressions: [], evidence: [], opportunities: [], candidates, sourceRoles: { "scys-mcp": "validation" } });
    expect(report).toContain("## 今天先查这 10 个词");
    expect(report).toContain("发现源找刚出现的表达");
    expect(report).toContain("scys-mcp（验证）");
    expect(report).toContain("### 1. AI短剧带货");
    expect(report).toContain("用户原话：正文提到“AI短剧带货”");
    expect(report).toContain("产品能力推导，待 Google Trends 验证");
    expect(report).toContain("证据：A product can generate AI photos");
    expect(report).toContain("## 观察候选");
    expect(report).toContain("标题线索");
  });

  it("labels a transformed social query separately from an exact user phrase", () => {
    const candidates: CandidateQueue = {
      formal: [{ candidateId: "candidate-social", term: "AI email gatekeeper", sourceType: "manual", context: "完整社媒原文", reason: "正文出现明确需求表达", lane: "formal", sourceSignalId: "social", sourceUrl: "https://x.com/example/status/1", trendsUrl: "https://trends.google.com/trends/explore?q=AI", score: 90, missingFields: ["Google Trends 7d"], evidenceQuote: "每个电子邮件收件箱很快都会有一个代理守门人。", evidenceOrigin: "user_evidence", evidenceTransformation: "将社媒观点归纳为可搜索短语", evidencePrecision: "semantic" }],
      backup: [],
    };
    const report = renderMarkdownReport({ summary: { date: "2026-08-24", sourceHealth: [], sourcesAttempted: ["manual"] }, sourceHealth: [], signals: [], expressions: [], evidence: [], opportunities: [], candidates });
    expect(report).toContain("类型：社媒观点归纳，待 Google Trends 验证");
    expect(report).toContain("证据：每个电子邮件收件箱很快都会有一个代理守门人");
    expect(report).not.toContain("用户原话：每个电子邮件收件箱");
  });

  it("labels feedback, capability, and entity evidence as separate tracks", () => {
    const candidates: CandidateQueue = {
      formal: [
        { candidateId: "candidate-feedback", term: "replace Zapier", sourceType: "github", context: "I need an alternative to Zapier.", reason: "用户反馈", lane: "formal", sourceSignalId: "issue-1", sourceUrl: "https://github.com/acme/flowpilot/issues/12", trendsUrl: "https://trends.google.com/trends/explore?q=replace", score: 220, missingFields: [], evidenceQuote: "I need an alternative to Zapier.", evidenceOrigin: "user_evidence", evidencePrecision: "exact" },
        { candidateId: "candidate-capability", term: "internal tool builder", sourceType: "github", context: "A platform for building internal tools.", reason: "产品能力", lane: "formal", sourceSignalId: "repo-1", sourceUrl: "https://github.com/acme/flowpilot", trendsUrl: "https://trends.google.com/trends/explore?q=internal", score: 180, missingFields: ["用户原话/替代诉求待确认"], evidenceQuote: "A platform for building internal tools.", evidenceOrigin: "capability_derived", evidencePrecision: "semantic" },
      ],
      backup: [{ candidateId: "candidate-entity", term: "FlowPilot", sourceType: "producthunt", context: "FlowPilot", reason: "产品实体", lane: "backup", sourceSignalId: "launch-1", sourceUrl: "https://producthunt.com/posts/flowpilot", trendsUrl: "https://trends.google.com/trends/explore?q=FlowPilot", score: 100, missingFields: ["用户问题"] }],
    };
    const report = renderMarkdownReport({ summary: { date: "2026-09-01", sourceHealth: [], sourcesAttempted: ["github"] }, sourceHealth: [], signals: [], expressions: [], evidence: [], opportunities: [], candidates, discoverySummary: { date: "2026-09-01", totalRawSignals: 3, verificationPoolCount: 2, demandExpressionCount: 2, directDemandCount: 1, capabilityDerivedCount: 1, feedbackAttempted: 2, feedbackSucceeded: 1, feedbackUnavailable: 1, sourceQuality: [] } });
    expect(report).toContain("类型：用户原话需求");
    expect(report).toContain("类型：产品能力推导");
    expect(report).toContain("产品实体观察");
    expect(report).toContain("反馈补全：已获取 1 个反馈来源，不可用 1 个");
    expect(report).not.toContain("用户原话：A platform for building internal tools");
  });

  it("renders no-data Trends verification as observation", () => {
    const candidates: CandidateQueue = {
      formal: [{ candidateId: "candidate-no-data", term: "AI inbox agent", sourceType: "manual", context: "社媒原文", reason: "社媒观点已归纳为搜索词", lane: "formal", sourceSignalId: "social", sourceUrl: "https://x.com/example/status/2", trendsUrl: "https://trends.google.com/trends/explore?q=AI%20inbox%20agent", score: 90, missingFields: ["Google Trends 7d"], evidenceOrigin: "capability_derived", trendVerification: { candidateId: "candidate-no-data", provider: "google_trends_manual", checkedAt: "2026-08-31T11:00:00.000Z", window: "7d", region: "US", result: "no_data", relatedQueries: [] } }],
      backup: [],
    };
    const report = renderMarkdownReport({ summary: { date: "2026-08-31", sourceHealth: [], sourcesAttempted: ["manual"] }, sourceHealth: [], signals: [], expressions: [], evidence: [], opportunities: [], candidates });
    expect(report).toContain("暂无可见数据");
    expect(report).toContain("不代表没人搜");
    expect(report).toContain("48–72 小时后复查原词、词根和同义表达");
    expect(report).toContain("Trends 数据不足（不代表没人搜）");
    expect(report).not.toContain("尚缺：Google Trends 7d");
    expect(report).toContain("产品能力推导，Google Trends 暂无可见数据");
    expect(report).not.toContain("产品能力推导，待 Google Trends 验证");
  });

  it("attaches the latest Trends verification to the daily report", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-trends-report-"));
    try {
      const firstRun = await runRadar({ date: "2026-08-31", sourceNames: ["fixtures"], workspaceRoot });
      const candidate = firstRun.candidates?.formal[0];
      expect(candidate).toBeDefined();
      const store = new RunStore(workspaceRoot, "2026-08-31");
      await store.appendTrendVerification({ candidateId: candidate!.candidateId, provider: "google_trends_manual", checkedAt: "2026-08-31T11:00:00.000Z", window: "7d", region: "US", result: "no_data", relatedQueries: [] });
      const secondRun = await runRadar({ date: "2026-08-31", sourceNames: ["fixtures"], workspaceRoot });
      expect(secondRun.report).toContain("暂无可见数据（不代表没人搜）");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("renders verified Trends state and relative-value reminder", () => {
    const candidates: CandidateQueue = {
      formal: [{ candidateId: "candidate-rising", term: "AI workflow automation", sourceType: "manual", context: "用户正在搜索 AI 工作流自动化", reason: "正文出现明确需求表达", lane: "formal", sourceSignalId: "social", sourceUrl: "https://x.com/example/status/3", trendsUrl: "https://trends.google.com/trends/explore?q=AI%20workflow%20automation", score: 90, missingFields: [], trendVerification: { candidateId: "candidate-rising", provider: "google_trends_manual", checkedAt: "2026-08-31T11:00:00.000Z", window: "7d", region: "US", result: "rising", relatedQueries: [] } }],
      backup: [],
    };
    const report = renderMarkdownReport({ summary: { date: "2026-08-31", sourceHealth: [], sourcesAttempted: ["manual"] }, sourceHealth: [], signals: [], expressions: [], evidence: [], opportunities: [], candidates });
    expect(report).toContain("Trends 7d：上升 · US");
    expect(report).toContain("指数是相对值，不能直接代表绝对搜索量");
    expect(report).not.toContain("尚未自动验证");
  });

  it("renders inferred expressions as observation-only candidates", () => {
    const candidates: CandidateQueue = {
      formal: [],
      backup: [{ candidateId: "candidate-inferred", term: "AI-proof outreach", sourceType: "manual", context: "社媒原文", reason: "推测搜索词", lane: "backup", sourceSignalId: "social", sourceUrl: "https://x.com/example/status/1", trendsUrl: "https://trends.google.com/trends/explore?q=AI", score: 40, missingFields: ["验证真实搜索表达"], evidenceQuote: "AI 生成邮件正在被反感。", evidenceOrigin: "user_evidence", evidencePrecision: "inferred" }],
    };
    const report = renderMarkdownReport({ summary: { date: "2026-08-24", sourceHealth: [], sourcesAttempted: ["manual"] }, sourceHealth: [], signals: [], expressions: [], evidence: [], opportunities: [], candidates });
    expect(report).toContain("AI-proof outreach · 推测搜索词，仅观察");
    expect(report).toContain("验证真实搜索表达");
  });

  it("rejects manual Trends verification for an unknown candidate", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-verify-"));
    try {
      await expect(main(["verify", "--date", "2026-08-24", "--candidate", "candidate-missing", "--result", "rising", "--workspace", workspaceRoot])).resolves.toBe(1);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("records manual Trends verification for a candidate in the queue object", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-verify-valid-"));
    try {
      const runDirectory = path.join(workspaceRoot, "data", "runs", "2026-08-31");
      await mkdir(runDirectory, { recursive: true });
      await writeFile(path.join(runDirectory, "candidates.json"), JSON.stringify({ formal: [{ candidateId: "candidate-known" }], backup: [] }), "utf8");
      await expect(main(["verify", "--date", "2026-08-31", "--candidate", "candidate-known", "--result", "no_data", "--region", "US", "--workspace", workspaceRoot])).resolves.toBe(0);
      const records = JSON.parse(await readFile(path.join(runDirectory, "trend-verifications.json"), "utf8")) as Array<{ candidateId: string; result: string }>;
      expect(records).toEqual([expect.objectContaining({ candidateId: "candidate-known", result: "no_data" })]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("keeps the daily report readable when source bodies are long", () => {
    const longText = "关键需求：用户想要一个可搜索的 AI 工作台。" + " 这是详情正文。".repeat(120);
    const candidates: CandidateQueue = {
      formal: [{ candidateId: "candidate-long", term: "AI 工作台", sourceType: "fixtures", context: longText, reason: "正文出现了具体表达", lane: "formal", sourceSignalId: "one", sourceUrl: "https://example.com/one", trendsUrl: "https://trends.google.com/trends/explore?q=AI", score: 90, missingFields: [] }],
      backup: [],
    };
    const report = renderMarkdownReport({ summary: { date: "2026-08-24", sourceHealth: [], sourcesAttempted: ["scys-mcp"] }, sourceHealth: [], signals: [signal("one")], expressions: [], evidence: [{ ...evidence("direct", "one", "direct"), quote: longText }], opportunities: [], candidates });
    expect(report.length).toBeLessThan(2500);
    expect(report).toContain("关键需求");
    expect(report).not.toContain("这是详情正文。 ".repeat(20));
  });

  it("renders required health, opportunity, evidence, risk, and coverage sections", () => {
    const health: SourceHealth[] = [
      { sourceType: "fixtures", status: "available", attemptedAt: "2026-08-24T00:00:00.000Z", itemCount: 2, failureReasons: [], coverageNotes: ["fixture coverage"] },
      { sourceType: "reddit-feed", status: "partial", attemptedAt: "2026-08-24T00:00:00.000Z", itemCount: 0, failureReasons: ["HTTP 429"], coverageNotes: ["coverage unavailable"] },
    ];
    const signals = [signal("one"), signal("failed", "reddit-feed", "failed")];
    const opportunities = [opportunity("action", "actionable"), opportunity("validating", "validating"), opportunity("watch", "watch"), opportunity("new", "new")];
    const summary = summarizeRun({ date: "2026-08-24", sourceHealth: health, signals, expressions: [], evidence: [evidence("direct", "one", "direct"), evidence("inferred", "one", "inferred")], opportunities });
    const report = renderMarkdownReport({ summary, sourceHealth: health, signals, expressions: [], evidence: [evidence("direct", "one", "direct")], opportunities });
    expect(report).toContain("## 今天先查这 10 个词");
    expect(report).toContain("## 来源状态");
    expect(report).toContain("## 今日提醒");
    expect(report).toContain("## 数据位置");
    expect(report).not.toContain("## 今日可行动机会");
    expect(report).not.toContain("## 原文证据");
    expect(report).toContain("Google Trends 尚未自动验证");
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
    expect(result.report).toContain("## 来源状态");
    expect(result.report).toContain("scys-mcp（验证）: available");
    expect(result.paths.report).toContain("data/runs/2026-08-24");
    for (const file of ["raw-signals.jsonl", "expressions.json", "evidence.json", "opportunities.json", "run-summary.json", "report.md"]) {
      await expect(readFile(path.join(workspaceRoot, "data", "runs", "2026-08-24", file), "utf8")).resolves.toBeTruthy();
    }
    const discovery = JSON.parse(await readFile(path.join(workspaceRoot, "data", "runs", "2026-08-24", "discovery-summary.json"), "utf8")) as { totalRawSignals: number; verificationPoolCount: number; sourceQuality: Array<{ sourceType: string; rawCount: number; candidateCount: number }> };
    expect(discovery.totalRawSignals).toBeGreaterThan(0);
    expect(discovery.verificationPoolCount).toBeGreaterThanOrEqual(0);
    expect(discovery.sourceQuality).toEqual(expect.arrayContaining([expect.objectContaining({ sourceType: "scys-mcp", rawCount: expect.any(Number), formalCandidateCount: expect.any(Number) })]));
  });

  it("attempts every configured discovery and validation source by default", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-default-sources-"));
    const result = await runRadar({ date: "2026-08-26", workspaceRoot });
    expect(result.summary.sourcesAttempted).toEqual(["producthunt", "github", "x-timeline", "reddit-feed", "scys-mcp"]);
    expect(result.summary.sourceHealth?.map((item) => item.sourceType)).toEqual(["producthunt", "github", "x-timeline", "reddit-feed", "scys-mcp"]);
    expect(result.report).toContain("scys-mcp（验证）");
    expect(result.report).toContain("producthunt（发现）");
  });

  it("does not enable implicit Product Hunt network access under Vitest", async () => {
    const previousToken = process.env.PRODUCT_HUNT_API_TOKEN;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    process.env.PRODUCT_HUNT_API_TOKEN = "test-token";
    try {
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-test-network-"));
      const result = await runRadar({ date: "2026-08-26", sourceNames: ["producthunt"], workspaceRoot });
      expect(result.summary.sourceHealth?.find((item) => item.sourceType === "producthunt")?.status).toBe("unverified");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (previousToken === undefined) delete process.env.PRODUCT_HUNT_API_TOKEN;
      else process.env.PRODUCT_HUNT_API_TOKEN = previousToken;
      fetchMock.mockRestore();
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
    expect(scysQueries).toEqual(["AI", "带货", "视频号"]);
  });

  it("keeps Task 9 sources explicit when requested", async () => {
    const result = await runRadar({ date: "2026-08-24", sourceNames: ["x-timeline"] });
    expect(result.summary.sourceHealth?.find((item) => item.sourceType === "x-timeline")).toMatchObject({ status: "unverified" });
  });

  it("runs injected X and Reddit sources with configured endpoints", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-social-registry-"));
    await writeFile(path.join(workspaceRoot, "radar.config.json"), JSON.stringify({ xTimeline: { enabled: true, handles: ["alice"] }, redditFeed: { enabled: true, communities: ["AI"] } }));
    const xUrls: string[] = [];
    const redditUrls: string[] = [];
    const result = await runRadar({ date: "2026-08-25", sourceNames: ["x-timeline", "reddit-feed"], workspaceRoot, transports: { xTimeline: async (request) => { xUrls.push(request.url); return { status: 200, headers: new Headers(), text: async () => JSON.stringify({ data: [] }) }; }, redditFeed: async (request) => { redditUrls.push(request.url); return { status: 200, headers: new Headers(), text: async () => JSON.stringify({ data: { children: [] } }) }; } } });
    expect(xUrls).toEqual(["https://api.x.example/timeline/alice/tweets"]);
    expect(redditUrls).toEqual(["https://www.reddit.example/r/AI/new.json"]);
    expect(result.summary.sourceHealth?.map((item) => item.status)).toEqual(["empty", "empty"]);
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
