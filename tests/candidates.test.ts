import { describe, expect, it } from "vitest";
import { buildCandidateQueue } from "../src/domain/candidates.js";
import type { RawSignal } from "../src/types.js";
import type { Expression } from "../src/types.js";

function signal(id: string, changes: Partial<RawSignal> = {}): RawSignal {
  return {
    id,
    sourceType: "scys-mcp",
    sourceName: "生财风向标",
    sourceUrl: `https://scys.com/topic/${id}`,
    externalId: id,
    title: "AI 新需求标题",
    body: "正文里有人明确提到“AI短剧带货”，并描述了具体使用场景。",
    author: { name: "作者" },
    publishedAt: "2026-08-24T00:00:00.000Z",
    fetchedAt: "2026-08-25T00:00:00.000Z",
    sourceTier: "community",
    sourceFingerprint: id,
    evidenceStatus: "verified",
    ...changes,
  };
}

describe("candidate queue", () => {
  it("extracts a concrete quoted term from body context and builds a 7-day Trends link", () => {
    const result = buildCandidateQueue([signal("one")], { now: "2026-08-25T00:00:00.000Z" });
    expect(result.formal).toHaveLength(1);
    expect(result.formal[0]).toMatchObject({
      term: "AI短剧带货",
      lane: "formal",
      context: expect.stringContaining("AI短剧带货"),
      trendsUrl: "https://trends.google.com/trends/explore?date=now%207-d&geo=CN&q=AI%E7%9F%AD%E5%89%A7%E5%B8%A6%E8%B4%A7",
    });
  });

  it("keeps title-only signals out of formal candidates", () => {
    const result = buildCandidateQueue([signal("title-only", { body: "AI 新需求标题", excerpt: undefined })]);
    expect(result.formal).toEqual([]);
    expect(result.backup[0]).toMatchObject({ lane: "backup", missingFields: ["正文上下文"] });
  });

  it("uses a specific title as the term when distinct body context supports it", () => {
    const result = buildCandidateQueue([signal("title-context", { title: "AI 工作流风向标", body: "正文说明了团队如何反复使用这个工作流，并遇到交付问题。" })]);
    expect(result.formal).toEqual([]);
    expect(result.backup[0]).toMatchObject({ lane: "backup" });
  });

  it("limits formal candidates to ten and lets skip feedback lower a candidate", () => {
    const signals = Array.from({ length: 11 }, (_, index) => signal(String(index), { body: `正文“新词${index}”需求场景` }));
    const result = buildCandidateQueue(signals, {
      feedback: [{ candidateId: "candidate-新词10", decision: "skip", recordedAt: "2026-08-25T01:00:00.000Z" }],
    });
    expect(result.formal).toHaveLength(10);
    expect(result.formal.some((item) => item.term === "新词10")).toBe(false);
  });

  it("turns fresh GitHub repositories into product terms and rejects stale collection lists", () => {
    const result = buildCandidateQueue([
      signal("github-product", { sourceType: "github", sourceName: "GitHub", title: "acme/flowpilot", body: "Workflow automation for teams.", publishedAt: "2026-08-24T00:00:00.000Z", sourceUrl: "https://github.com/acme/flowpilot" }),
      signal("github-list", { sourceType: "github", sourceName: "GitHub", title: "acme/awesome-ai-tools", body: "A curated list of AI tools.", publishedAt: "2025-01-01T00:00:00.000Z", sourceUrl: "https://github.com/acme/awesome-ai-tools" }),
    ], { now: "2026-08-25T00:00:00.000Z" });
    expect(result.backup).toEqual(expect.arrayContaining([expect.objectContaining({ term: "flowpilot" })]));
    expect(result.formal.some((item) => item.term.includes("/") || item.term.includes("awesome"))).toBe(false);
  });

  it("rejects fresh GitHub tutorial, toolkit, and collection-style repositories", () => {
    const result = buildCandidateQueue([
      signal("github-toolkit", { sourceType: "github", title: "microsoft/responsible-ai-toolbox", body: "Tools for understanding AI systems.", publishedAt: "2026-08-24T00:00:00.000Z" }),
      signal("github-beginners", { sourceType: "github", title: "microsoft/ai-agents-for-beginners", body: "Lessons for getting started.", publishedAt: "2026-08-24T00:00:00.000Z" }),
      signal("github-product", { sourceType: "github", title: "acme/codebase-memory-mcp", body: "Code intelligence MCP server.", publishedAt: "2026-08-24T00:00:00.000Z" }),
    ], { now: "2026-08-25T00:00:00.000Z" });
    expect(result.backup.map((item) => item.term)).toContain("codebase memory mcp");
  });

  it("keeps a lower-scoring SCYS candidate in the verification pool when GitHub dominates", () => {
    const githubSignals = Array.from({ length: 10 }, (_, index) => signal(`github-${index}`, {
      sourceType: "github", sourceName: "GitHub", title: `acme/product-${index}`, body: "A concrete product description.",
      sourceUrl: `https://github.com/acme/product-${index}`, publishedAt: "2026-08-25T00:00:00.000Z",
    }));
    const scysSignal = signal("scys-lower", {
      title: "AI 女装带货流程与选品", body: "正文介绍了 AI 女装带货的具体流程和选品方法。", publishedAt: "2026-08-10T00:00:00.000Z",
    });
    const result = buildCandidateQueue([...githubSignals, scysSignal], { now: "2026-08-25T00:00:00.000Z" });
    expect(result.formal.some((item) => item.sourceSignalId === "scys-lower")).toBe(true);
  });

  it("prioritizes a concrete user-language expression over a generic title", () => {
    const result = buildCandidateQueue([
      signal("generic", { title: "AI 风口来了", body: "AI、赚钱、创业" }),
      signal("specific", { title: "用户需求", body: "评论区有人问：有没有演唱会调色修图工具？保存还经常失败。" }),
    ], { now: "2026-08-25T00:00:00.000Z" });
    expect(result.formal.map((item) => item.term)).toContain("演唱会调色修图工具");
    expect(result.formal.map((item) => item.term)).not.toContain("AI");
    expect(result.formal.find((item) => item.term === "演唱会调色修图工具")).toMatchObject({ reason: expect.stringContaining("用户表达"), evidenceQuote: expect.stringContaining("演唱会") });
  });

  it("caps cluster candidates at ten", () => {
    const signals = Array.from({ length: 12 }, (_, index) => signal(`specific-${index}`, { title: "用户需求", body: `评论区有人问：${index}号演唱会调色修图工具。` }));
    const result = buildCandidateQueue(signals, { now: "2026-08-25T00:00:00.000Z", maxFormal: 10 });
    expect(result.formal).toHaveLength(10);
  });

  it("exposes why-now novelty metrics and prefers repeated recent language", () => {
    const repeated = signal("repeat", { body: "大家开始讨论一人公司自动化，想找能落地的方案。" });
    const once = signal("once", { body: "大家开始讨论陪跑式交付，想找能落地的方案。" });
    const previous: Expression = {
      id: "expression-一人公司自动化", text: "一人公司自动化", normalizedText: "一人公司自动化", aliases: [], kind: "concept",
      firstSeenAt: "2026-08-01T00:00:00.000Z", lastSeenAt: "2026-08-20T00:00:00.000Z", occurrences: [], sourceFamilies: ["scys-mcp"], independentAuthors: 1, independentCommunities: 1, independentPublishers: 1,
      lifecycle: "watch", trendState: "unknown", qualification: "discovered", rejectionReasons: [],
    };
    const result = buildCandidateQueue([repeated, once], { now: "2026-08-25T00:00:00.000Z", previousExpressions: [previous] });
    const candidate = result.formal.find((item) => item.term === "一人公司自动化");
    expect(candidate).toMatchObject({ recentMentions: 1, baselineMentions: 0 });
    expect(candidate?.whyNow?.length).toBeGreaterThan(0);
  });

  it("keeps single-source product entities and generic features in observation", () => {
    const result = buildCandidateQueue([
      signal("ph", { sourceType: "producthunt", title: "FlowPilot", body: "AI workflow copilot for creators." }),
      signal("gh", { sourceType: "github", title: "acme/agent-workflow", body: "Workflow automation toolkit." }),
    ], { now: "2026-08-25T00:00:00.000Z" });
    expect(result.formal.map((item) => item.term)).not.toEqual(expect.arrayContaining(["FlowPilot", "agent workflow"]));
    expect(result.backup.map((item) => item.term)).toEqual(expect.arrayContaining(["FlowPilot"]));
  });

  it("keeps a concrete user problem in the formal verification pool", () => {
    const result = buildCandidateQueue([signal("problem", { body: "用户问有没有一人公司自动化方案，想直接落地。" })], { now: "2026-08-25T00:00:00.000Z" });
    expect(result.formal.map((item) => item.term)).toContain("一人公司自动化");
  });

  it("does not promote a generic AI workflow title into the Trends pool", () => {
    const result = buildCandidateQueue([signal("generic-workflow", { title: "AI 工作流风向标", body: "社区成员分享了可复用的 AI 工作流。" })], { now: "2026-08-25T00:00:00.000Z" });
    expect(result.formal.map((item) => item.term)).not.toContain("AI 工作流");
  });
});
