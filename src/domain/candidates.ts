import type { ExpressionCluster, RawSignal, SeedTerm } from "../types.js";
import { normalizeExpression } from "./normalize.js";
import { clusterSeedTerms } from "./expression-clusters.js";
import { extractSeedTerms } from "./seed-terms.js";

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
};

export function buildCandidateQueue(signals: RawSignal[], options: CandidateQueueOptions = {}): CandidateQueue {
  const now = Date.parse(options.now ?? new Date().toISOString());
  const feedback = new Map((options.feedback ?? []).map((item) => [item.candidateId, item]));
  const formal = new Map<string, RadarCandidate>();
  const backup = new Map<string, RadarCandidate>();
  const seedTerms = options.seedTerms ?? signals.flatMap((signal) => extractSeedTerms(signal));
  const clusters = options.clusters ?? clusterSeedTerms(seedTerms, signals, options.now ?? new Date().toISOString());
  const signalById = new Map(signals.map((signal) => [signal.id, signal]));

  for (const cluster of clusters) {
    const signal = signalById.get(cluster.rawSignalIds[0] ?? "");
    if (!signal || signal.evidenceStatus === "failed") continue;
    const seed = seedTerms.find((item) => item.id === cluster.seedTermIds[0]);
    if (!seed) continue;
    addCandidate(formal, candidateForCluster(signal, cluster, seed, now, options.region ?? "CN", feedback));
  }

  for (const signal of signals.filter((item) => item.evidenceStatus !== "failed")) {
    if (signal.sourceType === "github" && !isRecentGitHubSignal(signal.publishedAt, now)) continue;
    if (seedTerms.some((item) => item.rawSignalId === signal.id)) continue;
    const title = usable(signal.title) ?? usable(signal.body) ?? "";
    if (!title) continue;
    const context = meaningfulContext(signal, title);
    const terms = context ? extractTerms(context) : [];
    if (context && terms.length === 0) {
      const titleTerm = deriveSpecificTitleTerm(title, signal.sourceType);
      if (titleTerm) terms.push(titleTerm);
    }
    if (context && terms.length > 0) {
      for (const term of terms) addCandidate(formal, candidateFor(signal, term, context, "formal", now, options.region ?? "CN", feedback));
    } else {
      addCandidate(backup, candidateFor(signal, title, context || title, "backup", now, options.region ?? "CN", feedback));
    }
  }

  const sort = (items: RadarCandidate[]) => items.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term, "zh-CN"));
  const formalItems = sort([...formal.values()]);
  const backupItems = sort([...backup.values()]);
  const maxFormal = options.maxFormal ?? 10;
  const maxBackup = options.maxBackup ?? 10;
  return {
    formal: selectDiverseFormal(formalItems.filter((item) => feedback.get(item.candidateId)?.decision !== "skip"), maxFormal),
    backup: backupItems.slice(0, maxBackup),
  };
}

function selectDiverseFormal(items: RadarCandidate[], limit: number): RadarCandidate[] {
  if (items.length <= limit) return items;
  const sourceTypes = [...new Set(items.map((item) => item.sourceType))];
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

function candidateFor(signal: RawSignal, term: string, context: string, lane: RadarCandidate["lane"], now: number, region = "CN", feedback: Map<string, CandidateFeedback>): RadarCandidate {
  const normalized = normalizeExpression(term).normalized;
  const candidateId = `candidate-${normalized}`;
  const decision = feedback.get(candidateId)?.decision;
  const freshness = signal.publishedAt ? freshnessScore(signal.publishedAt, now) : 0;
  const score = (lane === "formal" ? 60 : 10) + Math.min(normalized.length, 30) + freshness + (decision === "keep" ? 20 : decision === "false_positive" ? -100 : 0);
  const missingFields = lane === "formal" ? [] : ["正文上下文"];
  return {
    candidateId, term: term.trim(), sourceType: signal.sourceType, context: context.trim(),
    reason: lane === "formal" ? "正文出现了具体表达，适合先验证 Google Trends 过去 7 天增速" : "当前只有标题或缺少可抽取的正文表达，等待正文详情后再判断",
    lane, sourceSignalId: signal.id, sourceUrl: signal.sourceUrl,
    ...(signal.author?.name ? { authorName: signal.author.name } : {}),
    ...(signal.publishedAt ? { publishedAt: signal.publishedAt } : {}),
    trendsUrl: buildTrendsUrl(term.trim(), region), score, missingFields,
  };
}

function candidateForCluster(signal: RawSignal, cluster: ExpressionCluster, seed: SeedTerm, now: number, region: string, feedback: Map<string, CandidateFeedback>): RadarCandidate {
  const normalized = normalizeExpression(cluster.primaryTerm).normalized;
  const candidateId = `candidate-${normalized}`;
  const decision = feedback.get(candidateId)?.decision;
  const score = 70 + (cluster.freshness === "rising" ? 20 : cluster.freshness === "new" ? 12 : 0) + Math.min(cluster.sourceTypes.length * 4, 12) + Math.min(cluster.independentAuthors, 3) + (decision === "keep" ? 20 : decision === "false_positive" ? -100 : 0);
  return {
    candidateId, term: cluster.primaryTerm, sourceType: signal.sourceType, context: seed.quote,
    reason: `${seed.extractionReason}；${cluster.freshness === "rising" ? "多来源近期重复出现" : "近期首次发现"}；用户表达优先于标题`,
    lane: "formal", sourceSignalId: signal.id, sourceUrl: signal.sourceUrl,
    ...(signal.author?.name ? { authorName: signal.author.name } : {}), ...(signal.publishedAt ? { publishedAt: signal.publishedAt } : {}),
    trendsUrl: buildTrendsUrl(cluster.primaryTerm, region), score, missingFields: ["Google Trends 7d", "SERP/供给", "用户/商业证据"],
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
  const candidate = title.split(/[：:｜|丨-]/u)[0]?.trim()
    .replace(/(?:风向标|新玩法|实操流程|使用教程|教程|案例)$/u, "")
    .trim();
  if (!candidate || candidate.length < 2 || candidate.length > 24) return undefined;
  if (/^(AI|出海|赚钱|创业|带货|短视频)$/iu.test(candidate)) return undefined;
  return candidate;
}

function deriveGitHubTerm(title: string): string | undefined {
  const repository = title.split("/").pop()?.trim().replace(/[-_]+/gu, " ");
  if (!repository || repository.length < 3 || repository.length > 40) return undefined;
  if (/^(awesome|top|list|lists|collection|collections|ai tools?|agents?|mcp|tool|tools)(?:\b|\s)/iu.test(repository)) return undefined;
  if (/(?:toolkit|toolbox|beginners?|tutorial|course|prompts?[- ]and[- ]models|engineering|air[- ]conditioner)/iu.test(repository)) return undefined;
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
