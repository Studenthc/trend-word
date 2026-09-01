import { describe, expect, it } from "vitest";
import { assessDemandExpression, extractDemandExpressions } from "../src/domain/demand-expressions.js";
import type { RawSignal } from "../src/types.js";

function signal(changes: Partial<RawSignal> = {}): RawSignal {
  return {
    id: "ph-1", sourceType: "producthunt", sourceName: "Product Hunt", sourceUrl: "https://producthunt.com/posts/flowpilot",
    title: "FlowPilot", excerpt: "Self-hosted automation for teams", body: "Teams use FlowPilot to replace Zapier and automate repetitive customer workflows. Makers say users need a self-hosted workflow automation tool.",
    fetchedAt: "2026-08-30T00:00:00.000Z", sourceTier: "market", sourceFingerprint: "ph-1", evidenceStatus: "verified", ...changes,
  };
}

describe("demand expressions", () => {
  it("extracts task and alternative expressions with source quotes", () => {
    const expressions = extractDemandExpressions(signal());
    expect(expressions.map((item) => item.text)).toEqual(expect.arrayContaining(["automate repetitive customer workflows", "replace Zapier", "self-hosted workflow automation tool"]));
    expect(expressions.every((item) => item.rawSignalId === "ph-1" && item.evidenceQuote.length > 0)).toBe(true);
  });

  it("rejects a product-only or marketing-only description", () => {
    expect(extractDemandExpressions(signal({ title: "FlowPilot", body: "The most powerful, beautiful, revolutionary AI platform for modern teams." }))).toEqual([]);
  });

  it("caps output at three and rejects expressions without evidence", () => {
    const expressions = extractDemandExpressions(signal({ body: "Users need batch subtitle cleanup. Users need podcast translation. Users need image resizing. Users need invoice extraction." }));
    expect(expressions).toHaveLength(3);
    expect(expressions.every((item) => assessDemandExpression(item).qualityState !== "rejected")).toBe(true);
  });

  it("keeps unsupported product entities out of demand extraction", () => {
    expect(extractDemandExpressions(signal({ title: "FlowPilot", body: undefined, excerpt: "AI automation platform" }))).toEqual([]);
  });

  it("extracts common launch and community demand language", () => {
    const launch = extractDemandExpressions(signal({ body: "A launch for creators automating repetitive workflows." }));
    const community = extractDemandExpressions(signal({ body: "A builder asks for a practical workflow instead of another dashboard." }));
    expect(launch.map((item) => item.text)).toContain("repetitive workflow automation");
    expect(community).toEqual([]);
  });

  it("rejects generic workflow wording and downgrades launch copy to review", () => {
    const generic = extractDemandExpressions(signal({ body: "A community member asks for a practical workflow." }));
    const launch = extractDemandExpressions(signal({ body: "A launch for creators automating repetitive workflows." }));
    expect(generic).toEqual([]);
    expect(launch[0]).toMatchObject({ qualityState: "review" });
  });

  it("cleans GitHub Markdown and keeps product capability copy out of the formal lane", () => {
    const expressions = extractDemandExpressions(signal({ sourceType: "github", sourceName: "GitHub", sourceUrl: "https://github.com/acme/flowpilot", externalId: "acme/flowpilot", body: "The easiest way is creating a [ToolJet Cloud](https://example.com) app | Python | MIT |." }));
    expect(expressions[0]?.text).not.toContain("https://");
    expect(expressions[0]).toMatchObject({ qualityState: "review" });
  });

  it("does not treat a singular team mention as user evidence", () => {
    const expressions = extractDemandExpressions(signal({ body: "Murfy is a team of AI agents that helps to generate Beamer slides in minutes." }));
    expect(expressions[0]).toMatchObject({ qualityState: "review" });
  });

  it("turns product capability copy into a searchable query with provenance", () => {
    const photo = extractDemandExpressions(signal({ sourceType: "producthunt", body: "A launch for creators who generate AI photos." }));
    const notation = extractDemandExpressions(signal({ sourceType: "producthunt", body: "Create Hindustani classical music notation in a web app." }));
    expect(photo).toContainEqual(expect.objectContaining({ text: "AI photo generator", origin: "capability_derived", evidencePrecision: "semantic", qualityState: "review", transformation: expect.stringContaining("generator") }));
    expect(notation).toContainEqual(expect.objectContaining({ text: "Hindustani classical music notation", origin: "capability_derived" }));
    expect(photo[0]?.sourceText).toContain("generate AI photos");
  });

  it("does not label Product Hunt capability verbs as user evidence", () => {
    const result = extractDemandExpressions(signal({ sourceType: "producthunt", body: "Sargam Studio is a free, open-source web app for creating Hindustani classical music notation." }));
    expect(result).toContainEqual(expect.objectContaining({ text: "Hindustani classical music notation", origin: "capability_derived", qualityState: "review" }));
    expect(result.some((item) => item.text.startsWith("creating ") && item.origin === "user_evidence")).toBe(false);
  });

  it("bounds source text for large README details", () => {
    const result = extractDemandExpressions(signal({ sourceType: "github", body: "Users need batch subtitle cleanup. " + "Documentation. ".repeat(300) }));
    expect(result[0]?.sourceText.length).toBeLessThanOrEqual(2000);
  });

  it("normalizes capability sentences into noun-style search queries", () => {
    const result = extractDemandExpressions(signal({ sourceType: "github", body: "Factory is automating repetitive coding tasks at scale. ToolJet helps teams automate workflows. A tool can generate your own custom styles, in seconds." }));
    expect(result.map((item) => item.text)).toEqual(expect.arrayContaining(["repetitive coding task automation", "workflow automation", "custom style generator"]));
    expect(result.every((item) => item.origin === "capability_derived")).toBe(true);
  });

  it("drops operational setup instructions from capability queries", () => {
    const result = extractDemandExpressions(signal({ sourceType: "github", body: "Use this utility to automate the installation of the necessary packages. Start by creating a ToolJet Cloud account." }));
    expect(result).toEqual([]);
  });

  it("compresses long capability sentences into bounded search phrases", () => {
    const result = extractDemandExpressions(signal({ sourceType: "github", body: "ToolUniverse is an ecosystem for creating AI scientist systems from any large language model. Factory is automating repetitive coding tasks at scale. A tool helps create professional SEO articles, 2x faster." }));
    expect(result.map((item) => item.text)).toEqual(expect.arrayContaining(["AI scientist system", "repetitive coding task automation", "professional SEO article generator"]));
    expect(result.every((item) => item.text.length <= 42 && item.origin === "capability_derived")).toBe(true);
  });

  it("removes free-plan and source-product suffixes from capability queries", () => {
    const result = extractDemandExpressions(signal({ sourceType: "producthunt", body: "Create AI videos for free with Imgveo AI." }));
    expect(result).toContainEqual(expect.objectContaining({ text: "AI video generator", origin: "capability_derived" }));
  });

  it("turns building phrases into object-oriented search terms", () => {
    const result = extractDemandExpressions(signal({ sourceType: "github", body: "An AI-native platform for building internal tools and business applications." }));
    expect(result).toContainEqual(expect.objectContaining({ text: "internal tool builder", origin: "capability_derived" }));
  });

  it("cuts README lists and generic adjectives from building queries", () => {
    const result = extractDemandExpressions(signal({ sourceType: "github", body: "An AI-native platform for building internal tools, dashboards, business applications, workflows and AI agents. Designed for building modular, scalable, and secure AI workflows with an SDK." }));
    expect(result.map((item) => item.text)).toContain("internal tool builder");
    expect(result.map((item) => item.text)).not.toEqual(expect.arrayContaining(["internal tool dashboard business applications workflows builder", "modular scalable builder"]));
  });

  it("turns complete translated X evidence into searchable email expressions", () => {
    const result = extractDemandExpressions(signal({
      sourceType: "manual",
      sourceName: "X web list",
      sourceUrl: "https://x.com/gregisenberg/status/1",
      body: "我认为冷邮件即将消亡。每个电子邮件收件箱很快都会有一个代理守门人，唯一通过的方法将是热介绍，或者足够有趣以至于代理决定你值得它主人花时间。",
    }));
    expect(result.map((item) => item.text)).toEqual(expect.arrayContaining(["AI email gatekeeper", "agent-readable email"]));
    expect(result.map((item) => item.text)).not.toEqual(expect.arrayContaining(["快都会有一个代理", "够有趣以至于代理"]));
    expect(result.every((item) => item.evidenceQuote.length > 20 && item.sourceText.includes("代理守门人"))).toBe(true);
    expect(result.every((item) => item.transformation.length > 0)).toBe(true);
  });

  it("turns negative AI-email feedback into an outreach search expression", () => {
    const result = extractDemandExpressions(signal({
      sourceType: "manual",
      sourceName: "X web list",
      sourceUrl: "https://x.com/rowancheung/status/2",
      body: "回复 @gregisenberg：是的。而那些仍然发送 AI 生成邮件的人，真的很不正常。",
    }));
    expect(result).toContainEqual(expect.objectContaining({ text: "AI-proof outreach", origin: "user_evidence" }));
    expect(result[0]?.evidenceQuote).toContain("AI 生成邮件");
  });

  it("does not emit action clauses or vendor-specific management phrases", () => {
    const belief = extractDemandExpressions(signal({ sourceType: "producthunt", body: "Believe It is an ancient-world strategy game where you create a fictional belief and shape its rise across cities." }));
    const oracle = extractDemandExpressions(signal({ sourceType: "github", body: "Repository containing MCP servers that provides a suite of tools for managing and interacting with Oracle products." }));
    const conjunctions = extractDemandExpressions(signal({ sourceType: "github", body: "ToolJet is an AI-native platform for building and deploying internal tools. PixPark can generate and edit images." }));
    const emailCopy = extractDemandExpressions(signal({ sourceType: "github", body: "ChatGPT Writer - Generate entire emails and messages using ChatGPT AI." }));
    const sourceClause = extractDemandExpressions(signal({ sourceType: "github", body: "GPT Engineer is an AI agent for building full applications from natural language." }));
    const genericTool = extractDemandExpressions(signal({ sourceType: "github", body: "A utility helps users create lightweight tools." }));
    const toClause = extractDemandExpressions(signal({ sourceType: "github", body: "Agent Builder can create intelligent agents to automate workflows." }));
    const curatedList = extractDemandExpressions(signal({ sourceType: "github", title: "acme/awesome-ai-tools", externalId: "acme/awesome-ai-tools", body: "GPT Engineer is an AI agent for building full applications from natural language. Factory is automating repetitive coding tasks at scale." }));
    const markdownGuide = extractDemandExpressions(signal({ sourceType: "github", title: "crewAIInc/crewAI-tools", externalId: "crewAIInc/crewAI-tools", body: "## Creating Custom Tools\nCrewAI offers two straightforward approaches to creating custom tools:\n### Subclassing BaseTool\nDefine your tool by subclassing." }));
    expect(belief.map((item) => item.text)).not.toContain("fictional belief and shape its rise across cities");
    expect(oracle).toEqual([]);
    expect(conjunctions.map((item) => item.text)).toEqual(expect.arrayContaining(["internal tool builder", "image generator"]));
    expect(conjunctions.map((item) => item.text)).not.toEqual(expect.arrayContaining(["and deploying internal tool builder", "and edit image generator"]));
    expect(emailCopy).toEqual([]);
    expect(sourceClause.map((item) => item.text)).toContain("full application builder");
    expect(sourceClause.map((item) => item.text)).not.toContain("full applications from natural language builder");
    expect(genericTool).toEqual([]);
    expect(toClause.map((item) => item.text)).toContain("intelligent agent");
    expect(toClause.map((item) => item.text)).not.toContain("intelligent agents to automate workflow");
    expect(curatedList).toEqual([]);
    expect(markdownGuide).toEqual([]);
  });

  it("marks exact, semantic, and inferred expressions by evidence precision", () => {
    const exact = extractDemandExpressions(signal({ body: "Users need an AI photo generator." }));
    const semantic = extractDemandExpressions(signal({ sourceType: "producthunt", body: "Create AI photos in one click." }));
    const inferred = extractDemandExpressions(signal({ sourceType: "manual", body: "那些仍然发送 AI 生成邮件的人，真的很不正常。" }));
    expect(exact).toContainEqual(expect.objectContaining({ text: "AI photo generator", evidencePrecision: "exact" }));
    expect(semantic).toContainEqual(expect.objectContaining({ text: "AI photo generator", evidencePrecision: "semantic" }));
    expect(inferred).toContainEqual(expect.objectContaining({ text: "AI-proof outreach", evidencePrecision: "inferred" }));
  });

  it("summarizes a Claude Code infrastructure workflow without copying the sentence", () => {
    const result = extractDemandExpressions(signal({
      sourceType: "manual",
      sourceName: "X web list",
      sourceUrl: "https://x.com/levelsio/status/3",
      body: "我最喜欢 Cloudflare 的一点是，使用它们来管理你的服务器有多么简单。它们一直都有很棒的 API，你只需要添加一个 API 令牌，就能完成几乎所有手动操作。我最喜欢的是用 Claude Code 完全注册域名。",
    }));
    expect(result.map((item) => item.text)).toEqual(expect.arrayContaining(["AI infrastructure automation", "AI domain registration"]));
    expect(result.map((item) => item.text).some((item) => item.length > 42)).toBe(false);
  });

  it("extracts direct demand from GitHub issue feedback", () => {
    const result = extractDemandExpressions(signal({
      sourceType: "github", sourceName: "GitHub Issues", sourceUrl: "https://github.com/acme/flowpilot/issues/12", externalId: "acme/flowpilot#12",
      signalKind: "feedback", parentSignalId: "github-flowpilot", tags: ["feedback", "github-issue"],
      title: "Looking for a Zapier alternative", body: "I need an alternative to Zapier.",
    }));
    expect(result).toContainEqual(expect.objectContaining({ text: "replace Zapier", origin: "user_evidence", evidencePrecision: "exact", qualityState: "verified", sourceEntityId: "entity-github-github-flowpilot" }));
    expect(result.map((item) => item.text)).not.toContain("alternative to Zapier");
  });

  it("recognizes title-style, feature-request, and how-to feedback language", () => {
    const title = extractDemandExpressions(signal({ sourceType: "github", sourceName: "GitHub Issues", sourceUrl: "https://github.com/acme/flowpilot/issues/14", externalId: "acme/flowpilot#14", signalKind: "feedback", parentSignalId: "github-flowpilot", tags: ["feedback", "github-issue"], title: "Looking for a Zapier alternative", body: "" }));
    const feature = extractDemandExpressions(signal({ sourceType: "github", sourceName: "GitHub Issues", sourceUrl: "https://github.com/acme/flowpilot/issues/15", externalId: "acme/flowpilot#15", signalKind: "feedback", parentSignalId: "github-flowpilot", tags: ["feedback", "github-issue"], title: "Feature request", body: "Feature request: export generated reports." }));
    const question = extractDemandExpressions(signal({ sourceType: "producthunt", sourceName: "Product Hunt comments", sourceUrl: "https://producthunt.com/posts/flowpilot", externalId: "ph-1#comment-2", signalKind: "feedback", parentSignalId: "producthunt-flowpilot", tags: ["feedback", "producthunt-comment"], title: "Comment", body: "How do I export generated reports?" }));
    expect(title).toContainEqual(expect.objectContaining({ text: "Zapier alternative", origin: "user_evidence", evidencePrecision: "exact" }));
    expect(feature).toContainEqual(expect.objectContaining({ text: "export generated reports", origin: "user_evidence", evidencePrecision: "exact" }));
    expect(question).toContainEqual(expect.objectContaining({ text: "export generated reports", origin: "user_evidence", evidencePrecision: "exact" }));
  });

  it("does not promote descriptive issue or comment sentences into search queries", () => {
    const examples = [
      { sourceType: "producthunt" as const, sourceName: "Product Hunt comments", sourceUrl: "https://producthunt.com/posts/asoon", externalId: "ph-2#comment-1", title: "Comment on ASOon", body: "Apple doesn't publish those." },
      { sourceType: "producthunt" as const, sourceName: "Product Hunt comments", sourceUrl: "https://producthunt.com/posts/prozollo", externalId: "ph-3#comment-1", title: "Comment on Prozollo", body: "Live contrast checking so you can't ship an unreadable accent." },
      { sourceType: "github" as const, sourceName: "GitHub Issues", sourceUrl: "https://github.com/acme/flowpilot/issues/16", externalId: "acme/flowpilot#16", title: "The failure is silent", body: "The failure is silent." },
      { sourceType: "github" as const, sourceName: "GitHub Issues", sourceUrl: "https://github.com/acme/flowpilot/issues/17", externalId: "acme/flowpilot#17", title: "TikTok Direct Post can duplicate posts after ambiguous retries", body: "A retry can create duplicate posts." },
    ];
    for (const example of examples) {
      expect(extractDemandExpressions(signal({ ...example, signalKind: "feedback", parentSignalId: "parent", tags: ["feedback"] }))).toEqual([]);
    }
  });

  it("keeps direct feedback queries short and rejects generic build intent", () => {
    const exportRequest = extractDemandExpressions(signal({ sourceType: "github", sourceName: "GitHub Issues", sourceUrl: "https://github.com/acme/flowpilot/issues/18", externalId: "acme/flowpilot#18", signalKind: "feedback", parentSignalId: "parent", tags: ["feedback"], title: "Feature request", body: "I need a way to export generated reports." }));
    const buildIntent = extractDemandExpressions(signal({ sourceType: "producthunt", sourceName: "Product Hunt comments", sourceUrl: "https://producthunt.com/posts/flowpilot", externalId: "ph-4#comment-1", signalKind: "feedback", parentSignalId: "parent", tags: ["feedback"], title: "Comment", body: "That's what I want to build next." }));
    expect(exportRequest).toContainEqual(expect.objectContaining({ text: "export generated reports", origin: "user_evidence", evidencePrecision: "exact" }));
    expect(exportRequest[0]?.text.split(/\s+/u).length).toBeLessThanOrEqual(6);
    expect(buildIntent).toEqual([]);
  });

  it("extracts direct demand from Product Hunt comment feedback", () => {
    const result = extractDemandExpressions(signal({
      sourceType: "producthunt", sourceName: "Product Hunt comments", sourceUrl: "https://producthunt.com/posts/flowpilot", externalId: "ph-1#comment-1",
      signalKind: "feedback", parentSignalId: "producthunt-flowpilot", tags: ["feedback", "producthunt-comment"],
      title: "Comment on FlowPilot", body: "I need a way to export generated reports.",
    }));
    expect(result).toContainEqual(expect.objectContaining({ text: "export generated reports", origin: "user_evidence", evidencePrecision: "exact", evidenceQuote: expect.stringContaining("export") }));
  });
});
