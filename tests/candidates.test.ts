import { describe, expect, it } from "vitest";
import { buildCandidateQueue } from "../src/domain/candidates.js";
import type { DemandExpression, RawSignal } from "../src/types.js";
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
  it("keeps model-catalog capability evidence in the Trends queue while direct evidence stays formal", () => {
    const modelSignal = signal("model-signal", {
      sourceType: "model-catalog", sourceName: "Hugging Face", sourceUrl: "https://huggingface.co/acme/reference-to-video",
      title: "acme/reference-to-video", body: "reference-to-video", tags: ["model-catalog:huggingface"], signalKind: "entity",
    });
    const directSignal = signal("direct-signal", { sourceType: "manual", sourceName: "X", sourceUrl: "https://x.com/example/status/1", body: "Users need reference to video." });
    const base = { text: "reference to video", normalizedText: "reference to video", type: "task" as const, sourceEntityId: "entity-reference-to-video", evidenceLocation: "body" as const, evidenceGrade: "inferred" as const, qualityState: "review" as const, qualityScore: 55, origin: "capability_derived" as const, sourceText: "reference-to-video", transformation: "derived", evidencePrecision: "semantic" as const, firstSeenAt: "2026-09-03T00:00:00.000Z" };
    const result = buildCandidateQueue([modelSignal, directSignal], { now: "2026-09-03T00:00:00.000Z", demandExpressions: [
      { ...base, id: "model-demand", rawSignalId: "model-signal", sourceType: "model-catalog", sourceUrl: modelSignal.sourceUrl, evidenceQuote: "模型目录能力：image-to-video" },
      { ...base, id: "direct-demand", rawSignalId: "direct-signal", sourceType: "manual", sourceUrl: directSignal.sourceUrl, evidenceGrade: "direct", qualityState: "verified", qualityScore: 90, origin: "user_evidence", sourceText: "Users need image to video", transformation: "保留原文需求表达", evidencePrecision: "exact", evidenceQuote: "Users need image to video" },
    ] });

    expect(result.formal.map((item) => item.term)).toEqual(["reference to video", "reference to video"]);
    expect(result.formal).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: "model-catalog", evidenceOrigin: "capability_derived", lane: "formal", missingFields: ["Google Trends 7d"] }),
      expect.objectContaining({ sourceType: "manual", evidenceOrigin: "user_evidence" }),
    ]));
    expect(result.formal.find((item) => item.sourceType === "model-catalog")?.whyNow?.[0]).toContain("模型能力");
    expect(result.backup).not.toEqual(expect.arrayContaining([expect.objectContaining({ sourceType: "model-catalog" })]));

    const entityOnly = buildCandidateQueue([signal("model-entity-only", { sourceType: "model-catalog", sourceName: "Hugging Face", sourceUrl: "https://huggingface.co/acme/opaque-v2", title: "acme/opaque-v2", body: "safetensors, license:mit, region:us", signalKind: "entity" })], { now: "2026-09-03T00:00:00.000Z" });
    expect(entityOnly.formal).toEqual([]);
    expect(entityOnly.backup).toEqual([]);
  });

  it("filters mature baseline model capabilities out of the Trends queue", () => {
    const baselineSignal = signal("model-baseline", { sourceType: "model-catalog", sourceName: "fal.ai", sourceUrl: "https://fal.ai/models/acme/image-to-video", title: "acme/image-to-video", body: "image-to-video", signalKind: "entity" });
    const specificSignal = signal("model-specific", { sourceType: "model-catalog", sourceName: "fal.ai", sourceUrl: "https://fal.ai/models/acme/region-edit", title: "acme/region-edit", body: "region-specific-image-editing", signalKind: "entity" });
    const demand = (id: string, rawSignalId: string, text: string): DemandExpression => ({
      id, text, normalizedText: text, type: "task", rawSignalId, sourceEntityId: `entity-${id}`, sourceType: "model-catalog", sourceUrl: `https://fal.ai/models/acme/${id}`,
      evidenceQuote: `模型目录能力：${text}`, evidenceLocation: "metadata", evidenceGrade: "inferred", qualityState: "review", qualityScore: 55, origin: "capability_derived", sourceText: text, transformation: "derived", evidencePrecision: "semantic", firstSeenAt: "2026-09-03T00:00:00.000Z",
    });
    const result = buildCandidateQueue([baselineSignal, specificSignal], { now: "2026-09-03T00:00:00.000Z", demandExpressions: [
      demand("baseline-image-video", baselineSignal.id, "image to video"),
      demand("baseline-tts", baselineSignal.id, "text to speech"),
      demand("baseline-style", baselineSignal.id, "image style transfer"),
      demand("baseline-translation", baselineSignal.id, "text translation"),
      demand("baseline-local", baselineSignal.id, "local inference engine"),
      demand("baseline-asr", baselineSignal.id, "speech to text"),
      demand("specific", specificSignal.id, "region specific image editing"),
    ] });

    expect(result.formal.map((item) => item.term)).toEqual(["region specific image editing"]);
    expect(result.formal.concat(result.backup).map((item) => item.term)).not.toContain("image to video");
  });

  it("keeps distinct capability queries from one model source", () => {
    const modelSignal = signal("model-multi-capability", { sourceType: "model-catalog", sourceName: "fal.ai", sourceUrl: "https://fal.ai/models/acme/edit", title: "acme/edit", body: "region-specific image editing with layer separation", signalKind: "entity" });
    const makeDemand = (id: string, text: string): DemandExpression => ({
      id, text, normalizedText: text, type: "task", rawSignalId: modelSignal.id, sourceEntityId: `entity-${id}`, sourceType: "model-catalog", sourceUrl: modelSignal.sourceUrl,
      evidenceQuote: `模型目录能力：${text}`, evidenceLocation: "metadata", evidenceGrade: "inferred", qualityState: "review", qualityScore: 55, origin: "capability_derived", sourceText: text, transformation: "derived", evidencePrecision: "semantic", firstSeenAt: "2026-09-03T00:00:00.000Z",
    });

    const result = buildCandidateQueue([modelSignal], { now: "2026-09-03T00:00:00.000Z", demandExpressions: [makeDemand("region", "region specific image editing"), makeDemand("layer", "layer aware image editing")] });

    expect(result.formal.map((item) => item.term)).toEqual(["layer aware image editing", "region specific image editing"]);
  });

  it("prioritizes concrete model combinations and capability modifiers", () => {
    const models = [
      signal("model-combination", { sourceType: "model-catalog", sourceName: "fal.ai", sourceUrl: "https://fal.ai/models/acme/video", title: "acme/video", body: "image-to-video", signalKind: "entity" }),
      signal("model-region", { sourceType: "model-catalog", sourceName: "fal.ai", sourceUrl: "https://fal.ai/models/acme/region-edit", title: "acme/region-edit", body: "region-specific-image-editing", signalKind: "entity" }),
      signal("model-baseline-priority", { sourceType: "model-catalog", sourceName: "Hugging Face", sourceUrl: "https://huggingface.co/acme/tts", title: "acme/tts", body: "text-to-speech", signalKind: "entity" }),
    ];
    const demand = (id: string, rawSignalId: string, text: string, qualityScore = 55): DemandExpression => ({
      id, text, normalizedText: text, type: "task", rawSignalId, sourceEntityId: `entity-${id}`, sourceType: "model-catalog", sourceUrl: `https://example.com/${id}`,
      evidenceQuote: text.includes("voiceover") ? "组合假设：image-to-video → text-to-speech" : `模型目录能力：${text}`, evidenceLocation: "metadata", evidenceGrade: "inferred", qualityState: "review", qualityScore, origin: "capability_derived", sourceText: text, transformation: "derived", evidencePrecision: "semantic", firstSeenAt: "2026-09-03T00:00:00.000Z",
    });
    const result = buildCandidateQueue(models, { now: "2026-09-03T00:00:00.000Z", demandExpressions: [
      demand("combo", "model-combination", "product photo video with voiceover", 45),
      demand("region", "model-region", "region specific image editing"),
      demand("baseline", "model-baseline-priority", "text to speech"),
    ] });

    expect(result.formal.map((item) => item.term)).toEqual(["product photo video with voiceover", "region specific image editing"]);
  });

  it("uses the capability summary as the why-now explanation", () => {
    const modelSignal = signal("model-summary", { sourceType: "model-catalog", sourceName: "fal.ai", sourceUrl: "https://fal.ai/models/acme/region-edit", title: "acme/region-edit", body: "region-specific-image-editing", signalKind: "entity" });
    const demand: DemandExpression = {
      id: "demand-summary", text: "region specific image editing", normalizedText: "region specific image editing", type: "task", rawSignalId: modelSignal.id, sourceEntityId: "entity-summary", sourceType: "model-catalog", sourceUrl: modelSignal.sourceUrl,
      evidenceQuote: "能力总结：只修改图片中的指定区域或元素，保留其余画面；模型目录依据：region-specific-image-editing", evidenceLocation: "metadata", evidenceGrade: "inferred", qualityState: "review", qualityScore: 55, origin: "capability_derived", sourceText: "region-specific-image-editing", transformation: "derived", evidencePrecision: "semantic", firstSeenAt: "2026-09-03T00:00:00.000Z",
    };

    const result = buildCandidateQueue([modelSignal], { now: "2026-09-03T00:00:00.000Z", demandExpressions: [demand] });

    expect(result.formal[0]?.whyNow).toEqual(["模型能力：只修改图片中的指定区域或元素，保留其余画面"]);
  });
  it("ranks a verified demand expression ahead of its product entity with a distinct ID", () => {
    const demand: DemandExpression = {
      id: "demand-ph-1-0", text: "replace Zapier", normalizedText: "replace zapier", type: "alternative", rawSignalId: "ph-1", sourceEntityId: "entity-producthunt-ph-1", sourceType: "producthunt", sourceUrl: "https://producthunt.com/posts/flowpilot", evidenceQuote: "Teams use FlowPilot to replace Zapier.", evidenceLocation: "body", evidenceGrade: "direct", qualityState: "verified", qualityScore: 90, origin: "user_evidence", sourceText: "Teams use FlowPilot to replace Zapier.", transformation: "保留原文需求表达", firstSeenAt: "2026-08-25T00:00:00.000Z",
    };
    const result = buildCandidateQueue([signal("ph-1", { sourceType: "producthunt", title: "FlowPilot", body: "FlowPilot" })], { demandExpressions: [demand], now: "2026-08-25T00:00:00.000Z" });
    expect(result.formal[0]).toMatchObject({ term: "replace Zapier", candidateId: "candidate-demand-user_evidence-replace zapier", evidenceKind: "alternative", evidenceQuote: expect.stringContaining("replace Zapier") });
    expect(result.backup.map((item) => item.candidateId)).toContain("candidate-entity-flowpilot");
  });

  it("keeps a launch-copy demand expression searchable while marking user evidence missing", () => {
    const demand: DemandExpression = {
      id: "demand-ph-2-0", text: "automating repetitive workflows", normalizedText: "automating repetitive workflows", type: "task", rawSignalId: "ph-2", sourceEntityId: "entity-producthunt-ph-2", sourceType: "producthunt", sourceUrl: "https://producthunt.com/posts/flowpilot", evidenceQuote: "A launch for creators automating repetitive workflows.", evidenceLocation: "body", evidenceGrade: "direct", qualityState: "review", qualityScore: 55, origin: "capability_derived", sourceText: "A launch for creators automating repetitive workflows.", transformation: "保留能力表达等待趋势验证", firstSeenAt: "2026-08-25T00:00:00.000Z",
    };
    const result = buildCandidateQueue([signal("ph-2", { sourceType: "producthunt", title: "FlowPilot", body: "FlowPilot" })], { demandExpressions: [demand], now: "2026-08-25T00:00:00.000Z" });
    expect(result.formal.map((item) => item.term)).toContain("automating repetitive workflows");
    expect(result.formal[0]?.missingFields).toContain("用户原话/替代诉求待确认");
  });

  it("keeps direct and capability-derived versions of the same query independently rankable", () => {
    const base = { text: "AI photo generator", normalizedText: "ai photo generator", type: "task" as const, rawSignalId: "ph-3", sourceEntityId: "entity-producthunt-ph-3", sourceType: "producthunt" as const, sourceUrl: "https://producthunt.com/posts/photos", evidenceLocation: "body" as const, evidenceGrade: "direct" as const, firstSeenAt: "2026-08-25T00:00:00.000Z" };
    const result = buildCandidateQueue([signal("ph-3", { sourceType: "producthunt", title: "PhotoTool", body: "PhotoTool" })], { now: "2026-08-25T00:00:00.000Z", demandExpressions: [
      { ...base, id: "demand-direct", evidenceQuote: "Users need an AI photo generator", qualityState: "verified", qualityScore: 90, origin: "user_evidence", sourceText: "Users need an AI photo generator", transformation: "保留原文需求表达" },
      { ...base, id: "demand-derived", evidenceQuote: "A tool to generate AI photos", qualityState: "review", qualityScore: 55, origin: "capability_derived", sourceText: "A tool to generate AI photos", transformation: "将 generate + photos 改写为 generator" },
    ] });
    expect(result.formal.map((item) => item.candidateId)).toEqual(["candidate-demand-user_evidence-ai photo generator", "candidate-demand-capability_derived-ai photo generator"]);
  });

  it("does not add the social post title as a duplicate when a demand expression exists", () => {
    const social = signal("x-1", {
      sourceType: "manual", sourceName: "X web list", sourceUrl: "https://x.com/example/status/1",
      title: "AI 代理守门人让冷邮件失效", body: "每个电子邮件收件箱很快都会有一个代理守门人。",
    });
    const demand: DemandExpression = {
      id: "demand-x-1", text: "AI email gatekeeper", normalizedText: "ai email gatekeeper", type: "task", rawSignalId: "x-1", sourceEntityId: "entity-manual-x-1", sourceType: "manual", sourceUrl: social.sourceUrl,
      evidenceQuote: social.body ?? "", evidenceLocation: "body", evidenceGrade: "direct", qualityState: "verified", qualityScore: 80, origin: "user_evidence", sourceText: social.body ?? "", transformation: "归纳", evidencePrecision: "semantic", firstSeenAt: social.fetchedAt,
    };
    const result = buildCandidateQueue([social], { demandExpressions: [demand], now: "2026-08-25T00:00:00.000Z" });
    expect(result.formal.map((item) => item.term)).toEqual(["AI email gatekeeper"]);
    expect(result.formal.map((item) => item.term)).not.toContain("AI 代理守门人让冷邮件失效");
  });

  it("limits capability-derived formal terms to one per source entity", () => {
    const base = { normalizedText: "", type: "task" as const, rawSignalId: "github-one", sourceEntityId: "entity-github-one", sourceType: "github" as const, sourceUrl: "https://github.com/acme/one", evidenceLocation: "body" as const, evidenceGrade: "direct" as const, qualityState: "review" as const, qualityScore: 55, origin: "capability_derived" as const, sourceText: "Product capability", transformation: "归纳", firstSeenAt: "2026-08-25T00:00:00.000Z" };
    const result = buildCandidateQueue([signal("github-one", { sourceType: "github", sourceUrl: "https://github.com/acme/one", title: "acme/one", body: "Product capability" })], {
      now: "2026-08-25T00:00:00.000Z",
      demandExpressions: [
        { ...base, id: "demand-one", text: "customer inbox triage", normalizedText: "customer inbox triage", evidenceQuote: "Creates customer inbox triage" },
        { ...base, id: "demand-two", text: "customer inbox triage workflow", normalizedText: "customer inbox triage workflow", evidenceQuote: "Workflow for customer inbox triage" },
      ],
    });
    expect(result.formal.filter((item) => item.evidenceOrigin === "capability_derived")).toHaveLength(1);
  });

  it("keeps broad capability categories out of the formal Trends pool", () => {
    const demand: DemandExpression = {
      id: "demand-broad-agent", text: "intelligent agent", normalizedText: "intelligent agent", type: "task", rawSignalId: "github-broad", sourceEntityId: "entity-github-broad", sourceType: "github", sourceUrl: "https://github.com/acme/agent-builder", evidenceQuote: "Create intelligent agents to automate workflows.", evidenceLocation: "body", evidenceGrade: "direct", qualityState: "review", qualityScore: 55, origin: "capability_derived", sourceText: "Create intelligent agents to automate workflows.", transformation: "保留能力表达等待趋势验证", firstSeenAt: "2026-08-25T00:00:00.000Z",
    };
    const result = buildCandidateQueue([signal("github-broad", { sourceType: "github", title: "acme/agent-builder", body: "Create intelligent agents to automate workflows." })], { demandExpressions: [demand], now: "2026-08-25T00:00:00.000Z" });
    expect(result.formal.map((item) => item.term)).not.toContain("intelligent agent");
    expect(result.backup.find((item) => item.term === "intelligent agent")).toMatchObject({ missingFields: expect.arrayContaining(["验证真实搜索表达", "用户原话/替代诉求待确认"]) });
  });

  it.each(["AI scientist system builder", "internal tool builder"]) ("keeps broad capability suffixes out of the formal pool: %s", (term) => {
    const demand: DemandExpression = {
      id: `demand-${term}`, text: term, normalizedText: term.toLowerCase(), type: "task", rawSignalId: "github-broad-suffix", sourceEntityId: "entity-github-broad-suffix", sourceType: "github", sourceUrl: "https://github.com/acme/builder", evidenceQuote: `A product for ${term}.`, evidenceLocation: "body", evidenceGrade: "direct", qualityState: "review", qualityScore: 55, origin: "capability_derived", sourceText: `A product for ${term}.`, transformation: "保留能力表达等待趋势验证", firstSeenAt: "2026-08-25T00:00:00.000Z",
    };
    const result = buildCandidateQueue([signal("github-broad-suffix", { sourceType: "github", title: "acme/builder", body: demand.sourceText })], { demandExpressions: [demand], now: "2026-08-25T00:00:00.000Z" });
    expect(result.formal.map((item) => item.term)).not.toContain(term);
    expect(result.backup.map((item) => item.term)).toContain(term);
  });

  it("keeps long marketing sentences out of the formal capability pool", () => {
    const term = "one AI project if you do not have one yet builder";
    const demand: DemandExpression = {
      id: "demand-long-capability", text: term, normalizedText: term, type: "task", rawSignalId: "ph-long-capability", sourceEntityId: "entity-ph-long-capability", sourceType: "producthunt", sourceUrl: "https://producthunt.com/posts/long-copy", evidenceQuote: `Build ${term}.`, evidenceLocation: "body", evidenceGrade: "direct", qualityState: "review", qualityScore: 55, origin: "capability_derived", sourceText: `Build ${term}.`, transformation: "保留能力表达等待趋势验证", firstSeenAt: "2026-08-25T00:00:00.000Z",
    };
    const result = buildCandidateQueue([signal("ph-long-capability", { sourceType: "producthunt", title: "Long Copy", body: demand.sourceText })], { demandExpressions: [demand], now: "2026-08-25T00:00:00.000Z" });
    expect(result.formal.map((item) => item.term)).not.toContain(term);
    expect(result.backup.map((item) => item.term)).toContain(term);
  });

  it("does not promote GitHub README markup into a formal candidate", () => {
    const result = buildCandidateQueue([signal("github-markup", {
      sourceType: "github", sourceName: "GitHub", title: "acme/real-tool", sourceUrl: "https://github.com/acme/real-tool",
      body: "<div><img src=\"docs/banner.png\"></div> Install `./run.sh` and query `/v1/models`.",
    })], { now: "2026-08-25T00:00:00.000Z" });
    expect(result.formal).toEqual([]);
    expect(result.backup.map((item) => item.term)).not.toEqual(expect.arrayContaining(["docs/banner.png", "./run.sh", "/v1/models"]));
  });

  it("moves inferred search phrases to observation instead of the Trends pool", () => {
    const social = signal("x-inferred", { sourceType: "manual", sourceUrl: "https://x.com/example/status/2", title: "AI 邮件观点", body: "AI 生成邮件正在被反感。" });
    const demand: DemandExpression = {
      id: "demand-inferred", text: "AI-proof outreach", normalizedText: "ai proof outreach", type: "alternative", rawSignalId: "x-inferred", sourceEntityId: "entity-manual-x-inferred", sourceType: "manual", sourceUrl: social.sourceUrl,
      evidenceQuote: social.body ?? "", evidenceLocation: "body", evidenceGrade: "direct", qualityState: "review", qualityScore: 45, origin: "user_evidence", sourceText: social.body ?? "", transformation: "归纳", evidencePrecision: "inferred", firstSeenAt: social.fetchedAt,
    };
    const result = buildCandidateQueue([social], { demandExpressions: [demand], now: "2026-08-25T00:00:00.000Z" });
    expect(result.formal).toEqual([]);
    expect(result.backup[0]).toMatchObject({ term: "AI-proof outreach", evidencePrecision: "inferred", missingFields: expect.arrayContaining(["验证真实搜索表达"]) });
  });

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

  it("preserves hyphenated model names when deriving a title term", () => {
    const result = buildCandidateQueue([signal("hyphenated-model", { sourceType: "manual", title: "Hacker-Opus", body: "A new model behavior report." })], { now: "2026-09-01T00:00:00.000Z" });
    expect(result.formal.map((item) => item.term)).toContain("Hacker-Opus");
    expect(result.formal.map((item) => item.term)).not.toContain("Hacker");
  });

  it("keeps fresh manual discovery signals visible when the backup queue is capped", () => {
    const manualSignals = [
      signal("manual-hacker", { sourceType: "manual", title: "Hacker-Opus", body: "Hacker-Opus 的检查点用于研究奖励黑客行为。", sourceUrl: "https://x.com/example/status/hacker" }),
      signal("manual-twin", { sourceType: "manual", title: "digital twin seat availability", body: "一个真实体育场的数字孪生体显示每个座位的实际价格和可用性。", sourceUrl: "https://x.com/example/status/twin" }),
    ];
    const githubSignals = Array.from({ length: 12 }, (_, index) => signal(`github-noise-${index}`, {
      sourceType: "github", sourceName: "GitHub", title: `acme/product-${index}`, body: "A concrete product description.",
      sourceUrl: `https://github.com/acme/product-${index}`, publishedAt: "2026-09-01T00:00:00.000Z",
    }));
    const result = buildCandidateQueue([...manualSignals, ...githubSignals], { now: "2026-09-01T00:00:00.000Z", maxBackup: 10 });
    expect(result.backup.map((item) => item.sourceSignalId)).toEqual(expect.arrayContaining(["manual-hacker", "manual-twin"]));
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

  it("rejects generic GitHub topic repositories from the observation queue", () => {
    const result = buildCandidateQueue([
      signal("github-agent", { sourceType: "github", title: "jenssegers/agent", body: "Agent library.", publishedAt: "2026-08-24T00:00:00.000Z" }),
      signal("github-mcp", { sourceType: "github", title: "awslabs/mcp", body: "MCP examples.", publishedAt: "2026-08-24T00:00:00.000Z" }),
      signal("github-skills", { sourceType: "github", title: "addyosmani/agent-skills", body: "A collection of agent skills.", publishedAt: "2026-08-24T00:00:00.000Z" }),
      signal("github-agency", { sourceType: "github", title: "msitarzewski/agency-agents", body: "A collection of agents.", publishedAt: "2026-08-24T00:00:00.000Z" }),
      signal("github-air", { sourceType: "github", title: "YunYouJun/air-conditioner", body: "A desktop air conditioner controller.", publishedAt: "2026-08-24T00:00:00.000Z" }),
    ], { now: "2026-08-25T00:00:00.000Z" });
    expect(result.formal).toEqual([]);
    for (const term of ["agent", "mcp", "agent skills", "agency agents", "air conditioner"]) {
      expect(result.backup.map((item) => item.term)).not.toContain(term);
    }
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

  it("keeps a SCYS-only product entity in observation with a validation explanation", () => {
    const result = buildCandidateQueue([signal("scys-product", { title: "FlowPilot", body: "FlowPilot", excerpt: undefined })], {
      now: "2026-08-25T00:00:00.000Z",
      sourceRoles: { "scys-mcp": "validation" },
    });
    expect(result.formal).toHaveLength(0);
    expect(result.backup[0]).toMatchObject({ term: "FlowPilot", qualificationReason: expect.stringContaining("SCYS") });
  });

  it("keeps an explicit SCYS user problem in the formal pool", () => {
    const result = buildCandidateQueue([signal("scys-problem", { body: "用户问：有没有批量整理播客字幕的工具？", excerpt: undefined })], {
      now: "2026-08-25T00:00:00.000Z",
      sourceRoles: { "scys-mcp": "validation" },
    });
    expect(result.formal.map((item) => item.term)).toContain("批量整理播客字幕的工具");
  });
});
