import type { RawSignal } from "../types.js";
import { normalizeExpression } from "./normalize.js";

export type CandidateFeedback = {
  candidateId: string;
  decision: "keep" | "skip" | "false_positive";
  reason?: string;
  recordedAt: string;
};

export type RadarCandidate = {
  candidateId: string;
  term: string;
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
};

export type CandidateQueue = { formal: RadarCandidate[]; backup: RadarCandidate[] };

export type CandidateQueueOptions = {
  now?: string;
  region?: string;
  feedback?: CandidateFeedback[];
  maxFormal?: number;
  maxBackup?: number;
};

export function buildCandidateQueue(signals: RawSignal[], options: CandidateQueueOptions = {}): CandidateQueue {
  const now = Date.parse(options.now ?? new Date().toISOString());
  const feedback = new Map((options.feedback ?? []).map((item) => [item.candidateId, item]));
  const formal = new Map<string, RadarCandidate>();
  const backup = new Map<string, RadarCandidate>();

  for (const signal of signals.filter((item) => item.evidenceStatus !== "failed")) {
    const title = usable(signal.title) ?? usable(signal.body) ?? "";
    if (!title) continue;
    const context = meaningfulContext(signal, title);
    const terms = context ? extractTerms(context) : [];
    if (context && terms.length === 0) {
      const titleTerm = deriveSpecificTitleTerm(title);
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
    formal: formalItems.filter((item) => feedback.get(item.candidateId)?.decision !== "skip").slice(0, maxFormal),
    backup: backupItems.slice(0, maxBackup),
  };
}

function candidateFor(signal: RawSignal, term: string, context: string, lane: RadarCandidate["lane"], now: number, region = "CN", feedback: Map<string, CandidateFeedback>): RadarCandidate {
  const normalized = normalizeExpression(term).normalized;
  const candidateId = `candidate-${normalized}`;
  const decision = feedback.get(candidateId)?.decision;
  const freshness = signal.publishedAt ? freshnessScore(signal.publishedAt, now) : 0;
  const score = (lane === "formal" ? 60 : 10) + Math.min(normalized.length, 30) + freshness + (decision === "keep" ? 20 : decision === "false_positive" ? -100 : 0);
  const missingFields = lane === "formal" ? [] : ["正文上下文"];
  return {
    candidateId, term: term.trim(), context: context.trim(),
    reason: lane === "formal" ? "正文出现了具体表达，适合先验证 Google Trends 过去 7 天增速" : "当前只有标题或缺少可抽取的正文表达，等待正文详情后再判断",
    lane, sourceSignalId: signal.id, sourceUrl: signal.sourceUrl,
    ...(signal.author?.name ? { authorName: signal.author.name } : {}),
    ...(signal.publishedAt ? { publishedAt: signal.publishedAt } : {}),
    trendsUrl: buildTrendsUrl(term.trim(), region), score, missingFields,
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

function deriveSpecificTitleTerm(title: string): string | undefined {
  const candidate = title.split(/[：:｜|丨-]/u)[0]?.trim()
    .replace(/(?:风向标|新玩法|实操流程|使用教程|教程|案例)$/u, "")
    .trim();
  if (!candidate || candidate.length < 2 || candidate.length > 24) return undefined;
  if (/^(AI|出海|赚钱|创业|带货|短视频)$/iu.test(candidate)) return undefined;
  return candidate;
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
