import type { DemandExpression, Expression, ExpressionCluster, RawSignal, SeedTerm, SourceRole, SourceType, TrendVerification } from "../types.js";
import { normalizeExpression } from "./normalize.js";
import { clusterSeedTerms } from "./expression-clusters.js";
import { extractSeedTerms } from "./seed-terms.js";

const broadCapabilityPattern = /^(?:intelligent agents?|(?:ai|internal tool)(?:\s+\S+){0,3}\s+(?:agent|agents|builder|builders|automation|system|systems))$/iu;

export type CandidateFeedback = {
  candidateId: string;
  decision: "keep" | "skip" | "false_positive";
  reason?: string;
  recordedAt: string;
};

export type RadarCandidate = {
  candidateId: string;
  term: string;
  sourceType: RawSignal["sourceType"];
  context: string;
  reason: string;
  lane: "formal" | "backup";
  sourceSignalId: string;
  sourceUrl: string;
  authorName?: string;
  publishedAt?: string;
  trendsUrl: string;
  score: number;
  missingFields: string[];
  clusterId?: string;
  evidenceQuote?: string;
  freshness?: ExpressionCluster["freshness"];
  sourceCount?: number;
  qualificationReason?: string;
  evidenceKind?: "problem" | "search_term" | "concept" | "product" | "feature" | "model" | "play" | "task" | "pain" | "alternative";
  evidenceOrigin?: DemandExpression["origin"];
  evidenceTransformation?: string;
  evidencePrecision?: NonNullable<DemandExpression["evidencePrecision"]>;
  noveltyScore?: number;
  whyNow?: string[];
  recentMentions?: number;
  baselineMentions?: number;
  trendVerification?: TrendVerification;
};

export type CandidateQueue = { formal: RadarCandidate[]; backup: RadarCandidate[] };

export type CandidateQueueOptions = {
  now?: string;
  region?: string;
  feedback?: CandidateFeedback[];
  maxFormal?: number;
  maxBackup?: number;
  seedTerms?: SeedTerm[];
  clusters?: ExpressionCluster[];
  previousExpressions?: Expression[];
  sourceRoles?: Partial<Record<SourceType, SourceRole>>;
  demandExpressions?: DemandExpression[];
};

export function buildCandidateQueue(signals: RawSignal[], options: CandidateQueueOptions = {}): CandidateQueue {
  const now = Date.parse(options.now ?? new Date().toISOString());
  const feedback = new Map((options.feedback ?? []).map((item) => [item.candidateId, item]));
  const formal = new Map<string, RadarCandidate>();
  const backup = new Map<string, RadarCandidate>();
  const seedTerms = options.seedTerms ?? signals.flatMap((signal) => extractSeedTerms(signal));
  const clusters = options.clusters ?? clusterSeedTerms(seedTerms, signals, options.now ?? new Date().toISOString());
  const signalById = new Map(signals.map((signal) => [signal.id, signal]));

  for (const demand of options.demandExpressions ?? []) {
    const signal = signalById.get(demand.rawSignalId);
    if (!signal || demand.qualityState === "rejected") continue;
    const candidate = candidateForDemand(signal, demand, now, options.region ?? "CN", feedback);
    addCandidate(candidate.lane === "formal" ? formal : backup, candidate);
  }

  for (const cluster of clusters) {
    const signal = signalById.get(cluster.rawSignalIds[0] ?? "");
    if (!signal || signal.evidenceStatus === "failed") continue;
    const seed = seedTerms.find((item) => item.id === cluster.seedTermIds[0]);
    if (!seed) continue;
    const clusterCandidate = candidateForCluster(signal, cluster, seed, now, options.region ?? "CN", feedback, options.previousExpressions ?? [], options.sourceRoles ?? {});
    addCandidate(clusterCandidate.lane === "formal" ? formal : backup, clusterCandidate);
  }

  for (const signal of signals.filter((item) => item.evidenceStatus !== "failed")) {
    if (signal.sourceType === "github" && !isRecentGitHubSignal(signal.publishedAt, now)) continue;
    if (seedTerms.some((item) => item.rawSignalId === signal.id) || (options.demandExpressions ?? []).some((item) => item.rawSignalId === signal.id)) continue;
    const title = usable(signal.title) ?? usable(signal.body) ?? "";
    if (!title) continue;
    const context = meaningfulContext(signal, title);
    if (signal.sourceType === "model-catalog") {
      continue;
    }
    const terms = context && signal.sourceType !== "github" ? extractTerms(context) : [];
    if (context && terms.length === 0 && signal.sourceType !== "github" && !/(?:风口|新玩法|推荐|来了)$/u.test(title)) {
      const titleTerm = deriveSpecificTitleTerm(title, signal.sourceType);
      if (titleTerm) terms.push(titleTerm);
    }
    if (context && terms.length > 0) {
      for (const term of terms) addCandidate(formal, candidateFor(signal, term, context, "formal", now, options.region ?? "CN", feedback, options.sourceRoles ?? {}));
    } else {
      addCandidate(backup, candidateFor(signal, title, context || title, "backup", now, options.region ?? "CN", feedback, options.sourceRoles ?? {}));
    }
  }

  const sort = (items: RadarCandidate[]) => items.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term, "zh-CN"));
  const formalItems = sort([...formal.values()]);
  const backupItems = sort([...backup.values()]);
  const maxFormal = options.maxFormal ?? 10;
  const maxBackup = options.maxBackup ?? 10;
  return {
    formal: selectDiverseFormal(formalItems.filter((item) => feedback.get(item.candidateId)?.decision !== "skip"), maxFormal),
    backup: selectDiverseBackup(backupItems, maxBackup),
  };
}

function selectDiverseFormal(items: RadarCandidate[], limit: number): RadarCandidate[] {
  const sourceTypes = [...new Set(items.map((item) => item.sourceType))];
  const perSource = Math.max(1, Math.min(3, Math.floor(limit / sourceTypes.length)));
  const selected = new Map<string, RadarCandidate>();
  const capabilitySignals = new Set<string>();
  const select = (item: RadarCandidate): void => {
    if (item.evidenceOrigin === "capability_derived" && capabilitySignals.has(item.sourceSignalId)) return;
    selected.set(item.candidateId, item);
    if (item.evidenceOrigin === "capability_derived") capabilitySignals.add(item.sourceSignalId);
  };
  for (const sourceType of sourceTypes) {
    for (const item of items.filter((candidate) => candidate.sourceType === sourceType).slice(0, perSource)) select(item);
  }
  for (const item of items) {
    if (selected.size >= limit) break;
    select(item);
  }
  return [...selected.values()].slice(0, limit);
}

function selectDiverseBackup(items: RadarCandidate[], limit: number): RadarCandidate[] {
  if (items.length <= limit) return items;
  const sourceTypes = [...new Set(items.map((item) => item.sourceType))].sort((a, b) => backupSourcePriority(a) - backupSourcePriority(b));
  const perSource = Math.max(1, Math.min(3, Math.floor(limit / sourceTypes.length)));
  const selected = new Map<string, RadarCandidate>();
  for (const sourceType of sourceTypes) {
    for (const item of items.filter((candidate) => candidate.sourceType === sourceType).slice(0, perSource)) selected.set(item.candidateId, item);
  }
  for (const item of items) {
    if (selected.size >= limit) break;
    selected.set(item.candidateId, item);
  }
  return [...selected.values()].slice(0, limit);
}

function backupSourcePriority(sourceType: SourceType): number {
  if (["manual", "x-timeline", "reddit-feed"].includes(sourceType)) return 0;
  if (["github", "producthunt"].includes(sourceType)) return 1;
  return 2;
}

function candidateFor(signal: RawSignal, term: string, context: string, lane: RadarCandidate["lane"], now: number, region = "CN", feedback: Map<string, CandidateFeedback>, sourceRoles: Partial<Record<SourceType, SourceRole>> = {}): RadarCandidate {
  const normalized = normalizeExpression(term).normalized;
  const candidateId = `candidate-${normalized}`;
  const decision = feedback.get(candidateId)?.decision;
  const freshness = signal.publishedAt ? freshnessScore(signal.publishedAt, now) : 0;
  const score = (lane === "formal" ? 60 : 10) + Math.min(normalized.length, 30) + freshness + (decision === "keep" ? 20 : decision === "false_positive" ? -100 : 0);
  const missingFields = lane === "formal" ? [] : ["正文上下文"];
  return {
    candidateId, term: term.trim(), sourceType: signal.sourceType, context: context.trim(),
    reason: lane === "formal" ? "正文出现了具体表达，适合先验证 Google Trends 过去 7 天增速" : sourceRoles[signal.sourceType] === "validation" ? "SCYS 只作中文需求验证，等待早期发现源佐证" : "当前只有标题或缺少可抽取的正文表达，等待正文详情后再判断",
    lane, sourceSignalId: signal.id, sourceUrl: signal.sourceUrl,
    ...(signal.author?.name ? { authorName: signal.author.name } : {}),
    ...(signal.publishedAt ? { publishedAt: signal.publishedAt } : {}),
    trendsUrl: buildTrendsUrl(term.trim(), region), score, missingFields,
    noveltyScore: score, whyNow: lane === "formal" ? ["正文出现具体表达"] : [], recentMentions: signal.publishedAt && freshnessScore(signal.publishedAt, now) > 0 ? 1 : 0, baselineMentions: 0,
    ...(lane === "backup" && sourceRoles[signal.sourceType] === "validation" ? { qualificationReason: "SCYS 只作中文需求验证，等待早期发现源佐证" } : {}),
  };
}

function candidateForDemand(signal: RawSignal, demand: DemandExpression, now: number, region: string, feedback: Map<string, CandidateFeedback>): RadarCandidate {
  const candidateId = `candidate-demand-${demand.origin}-${demand.normalizedText}`;
  const decision = feedback.get(candidateId)?.decision;
  const recent = signal.publishedAt ? freshnessScore(signal.publishedAt, now) : 0;
  const precision = demand.evidencePrecision ?? inferEvidencePrecision(demand);
  const normalizedDemandText = demand.text.trim();
  const broadCapability = demand.origin === "capability_derived" && (broadCapabilityPattern.test(normalizedDemandText) || normalizedDemandText.split(/\s+/u).length > 5);
  const modelCatalogOnly = signal.sourceType === "model-catalog" && demand.origin === "capability_derived";
  const score = 140 + demand.qualityScore + recent + (decision === "keep" ? 20 : decision === "false_positive" ? -100 : 0);
  const formal = demand.qualityState !== "rejected" && precision !== "inferred" && !broadCapability && decision !== "false_positive";
  const missingFields = modelCatalogOnly
    ? formal ? ["Google Trends 7d"] : ["验证真实搜索表达", "Google Trends 7d"]
    : formal
    ? ["Google Trends 7d", "SERP/供给", ...(demand.origin === "capability_derived" ? ["用户原话/替代诉求待确认"] : ["用户/商业证据"])]
    : broadCapability ? ["验证真实搜索表达", "Google Trends 7d", "用户原话/替代诉求待确认"] : ["验证真实搜索表达", "Google Trends 7d", "用户/商业证据"];
  return {
    candidateId, term: demand.text, sourceType: signal.sourceType, context: demand.evidenceQuote,
    reason: modelCatalogOnly ? "模型能力推导，优先验证 Google Trends 过去 7 天增速" : formal ? demand.origin === "capability_derived" ? "产品能力可转成搜索词，优先验证 Google Trends 过去 7 天增速" : demand.transformation === "保留原文需求表达" ? "有原文任务、痛点或替代关系，优先验证 Google Trends 过去 7 天增速" : "社媒观点已归纳为搜索词，优先验证 Google Trends 过去 7 天增速" : broadCapability ? "产品能力词过宽，需先确认用户真实搜索表达" : "需求表达证据待人工确认",
    lane: formal ? "formal" : "backup", sourceSignalId: signal.id, sourceUrl: demand.sourceUrl,
    ...(signal.author?.name ? { authorName: signal.author.name } : {}), ...(signal.publishedAt ? { publishedAt: signal.publishedAt } : {}),
    trendsUrl: buildTrendsUrl(demand.text, region), score, missingFields,
    evidenceQuote: demand.evidenceQuote, evidenceKind: demand.type, evidenceOrigin: demand.origin, evidenceTransformation: demand.transformation, evidencePrecision: precision, noveltyScore: score, ...(modelCatalogOnly ? { qualificationReason: "模型能力推导，优先验证 Google Trends 过去 7 天增速" } : {}), whyNow: [demand.origin === "capability_derived" ? "产品能力可转成搜索词" : precision === "exact" ? "正文出现明确需求表达" : precision === "semantic" ? "原文语义可归纳为搜索词" : "社媒出现待验证的新说法"], recentMentions: 1, baselineMentions: 0,
  };
}

function inferEvidencePrecision(demand: DemandExpression): NonNullable<DemandExpression["evidencePrecision"]> {
  if (demand.transformation === "保留原文需求表达") return "exact";
  return demand.origin === "capability_derived" ? "semantic" : "inferred";
}

function candidateForCluster(signal: RawSignal, cluster: ExpressionCluster, seed: SeedTerm, now: number, region: string, feedback: Map<string, CandidateFeedback>, previousExpressions: Expression[], sourceRoles: Partial<Record<SourceType, SourceRole>>): RadarCandidate {
  const normalized = normalizeExpression(cluster.primaryTerm).normalized;
  const candidateId = `candidate-${seed.location === "metadata" ? "entity-" : ""}${normalized}`;
  const decision = feedback.get(candidateId)?.decision;
  const recentMentions = cluster.rawSignalIds.length;
  const baselineMentions = previousExpressions.find((item) => item.normalizedText === normalized)?.occurrences.length ?? 0;
  const noveltyScore = (cluster.freshness === "new" ? 35 : cluster.freshness === "rising" ? 25 : 5)
    + Math.min(recentMentions * 10, 30) + Math.min(cluster.independentAuthors * 5, 15) + Math.min(cluster.sourceTypes.length * 5, 15)
    + (seed.kind === "problem" ? 10 : 0) + (decision === "keep" ? 20 : decision === "false_positive" ? -100 : 0);
  const score = 70 + noveltyScore;
  const explicitQuestion = /(?:用户问|有没有|如何|怎么|求|想找|需要找|谁有)/u.test(seed.quote);
  const demandEvidence = seed.kind === "problem" || seed.kind === "search_term" || explicitQuestion || cluster.sourceTypes.length > 1 || cluster.rawSignalIds.length > 1;
  const role = sourceRoles[signal.sourceType] ?? "discovery";
  const validationOnly = role === "validation" && cluster.sourceTypes.every((sourceType) => (sourceRoles[sourceType] ?? "discovery") === "validation");
  const formal = demandEvidence && !(seed.location === "metadata" && cluster.sourceTypes.length === 1) && (!validationOnly || seed.kind === "problem" || seed.kind === "search_term" || explicitQuestion);
  const whyNow = [
    cluster.freshness === "rising" ? "7 天内多来源重复出现" : cluster.freshness === "new" ? "7 天内首次发现" : "近期仍有出现",
    `${recentMentions} 次提及`,
    ...(cluster.independentAuthors > 1 ? [`${cluster.independentAuthors} 位作者`] : []),
    ...(cluster.sourceTypes.length > 1 ? [`来自 ${cluster.sourceTypes.join("、")}`] : []),
  ];
  return {
    candidateId, term: cluster.primaryTerm, sourceType: signal.sourceType, context: seed.quote,
    reason: `${seed.extractionReason}；${cluster.freshness === "rising" ? "多来源近期重复出现" : "近期首次发现"}；用户表达优先于标题`,
    lane: formal ? "formal" : "backup", sourceSignalId: signal.id, sourceUrl: signal.sourceUrl,
    ...(signal.author?.name ? { authorName: signal.author.name } : {}), ...(signal.publishedAt ? { publishedAt: signal.publishedAt } : {}),
    trendsUrl: buildTrendsUrl(cluster.primaryTerm, region), score, noveltyScore, whyNow, recentMentions, baselineMentions, missingFields: formal ? ["Google Trends 7d", "SERP/供给", "用户/商业证据"] : ["用户问题", "第二个独立来源", "Google Trends 7d"],
    qualificationReason: formal ? "有用户问题或独立来源佐证" : validationOnly ? "SCYS 只作中文需求验证，产品/功能名需先有早期发现源佐证" : "单一来源的产品/功能实体，暂不进入 Trends 验证池",
    evidenceKind: seed.kind,
    clusterId: cluster.id, evidenceQuote: seed.quote.slice(0, 220), freshness: cluster.freshness, sourceCount: cluster.sourceTypes.length,
  };
}

function addCandidate(target: Map<string, RadarCandidate>, candidate: RadarCandidate): void {
  const existing = target.get(candidate.candidateId);
  if (!existing || candidate.score > existing.score) target.set(candidate.candidateId, candidate);
}

function meaningfulContext(signal: RawSignal, title: string): string | undefined {
  for (const value of [signal.body, signal.excerpt]) {
    const text = usable(value);
    if (text && normalizeExpression(text).normalized !== normalizeExpression(title).normalized && text.length > title.length) return text;
  }
  return undefined;
}

function extractTerms(context: string): string[] {
  const terms: string[] = [];
  const patterns = [/「([^」]{2,40})」/gu, /“([^”]{2,40})”/gu, /"([^"]{2,40})"/gu, /《([^》]{2,40})》/gu, /`([^`]{2,40})`/gu, /#([\p{L}\p{N}_-]{2,40})/gu];
  for (const pattern of patterns) {
    for (const match of context.matchAll(pattern)) {
      const term = (match[1] ?? "").trim();
      if (term && !terms.includes(term)) terms.push(term);
    }
  }
  return terms;
}

function deriveSpecificTitleTerm(title: string, sourceType: RawSignal["sourceType"] = "scys-mcp"): string | undefined {
  if (sourceType === "github") return deriveGitHubTerm(title);
  const candidate = title.split(/[：:｜|丨]|\s+-\s+/u)[0]?.trim()
    .replace(/(?:风向标|新玩法|实操流程|使用教程|教程|案例)$/u, "")
    .trim();
  if (!candidate || candidate.length < 2 || candidate.length > 24) return undefined;
  if (/^(AI|出海|赚钱|创业|带货|短视频|AI\s+(?:workflow|工作流|tool|tools|工具))$/iu.test(candidate)) return undefined;
  return candidate;
}

function deriveGitHubTerm(title: string): string | undefined {
  const repository = title.split("/").pop()?.trim().replace(/[-_]+/gu, " ");
  if (!repository || repository.length < 3 || repository.length > 40) return undefined;
  if (/^(awesome|top|list|lists|collection|collections|ai tools?|agents?|mcp|tool|tools)(?:\b|\s)/iu.test(repository)) return undefined;
  if (/(?:toolkit|toolbox|beginners?|tutorial|course|prompts?[- ]and[- ]models|engineering|air[- ]conditioner)/iu.test(repository)) return undefined;
  if (/^(?:agent|mcp|agent skills|agency agents|ai (?:research|sdk) tools|ai tools mng)$/iu.test(repository)) return undefined;
  return repository;
}

function isRecentGitHubSignal(publishedAt: string | undefined, now: number): boolean {
  if (!publishedAt) return false;
  const timestamp = Date.parse(publishedAt);
  return Number.isFinite(timestamp) && timestamp >= now - 30 * 86_400_000;
}

function buildTrendsUrl(term: string, region: string): string {
  return `https://trends.google.com/trends/explore?date=now%207-d&geo=${encodeURIComponent(region)}&q=${encodeURIComponent(term)}`;
}

function freshnessScore(publishedAt: string, now: number): number {
  const timestamp = Date.parse(publishedAt);
  if (Number.isNaN(timestamp)) return 0;
  const days = Math.max(0, (now - timestamp) / 86_400_000);
  return days <= 7 ? 20 : days <= 30 ? 10 : 0;
}

function usable(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text || undefined;
}
