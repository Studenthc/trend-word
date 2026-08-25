import type { DiscoverySummary, Evidence, Expression, Opportunity, RawSignal, RunSummary, SourceHealth } from "../types.js";
import type { CandidateQueue } from "../domain/candidates.js";

export type MarkdownReportInput = {
  summary: RunSummary;
  sourceHealth: SourceHealth[];
  signals: RawSignal[];
  expressions: Expression[];
  evidence: Evidence[];
  opportunities: Opportunity[];
  candidates?: CandidateQueue;
  discoverySummary?: DiscoverySummary;
};

const DAILY_REPORT_FORMAL_LIMIT = 10;

export function renderMarkdownReport(input: MarkdownReportInput): string {
  const lines = [`# 新词机会雷达 - ${input.summary.date}`, "", "## 今日验证池", ""];
  if (input.candidates) lines.push(...candidateSection(input.candidates));
  else lines.push("- 无（没有生成候选队列）");

  lines.push("", "## 来源状态", "");
  for (const source of input.sourceHealth) lines.push(...sourceStatusLines(source, input.discoverySummary));

  lines.push("", "## 今日提醒", "", ...reminderLines(input));
  lines.push("", "## 数据位置", "", ...dataLocationLines(input.summary));
  return `${lines.join("\n")}\n`;
}

function sourceStatusLines(source: SourceHealth, discovery?: DiscoverySummary): string[] {
  const quality = discovery?.sourceQuality.find((item) => item.sourceType === source.sourceType);
  const rawCount = quality?.rawCount ?? source.itemCount;
  const formalCount = quality?.formalCandidateCount ?? 0;
  const backupCount = quality?.backupCandidateCount ?? 0;
  const freshCount = quality?.freshCount ?? 0;
  const lines = [`- ${source.sourceType}: ${source.status} | 原始 ${rawCount} | 近7天 ${freshCount} | 验证池 ${formalCount} | 备选 ${backupCount}`];
  for (const note of [...source.failureReasons, ...source.coverageNotes].slice(0, 2)) lines.push(`  - ${excerpt(note, 50)}`);
  return lines;
}

function reminderLines(input: MarkdownReportInput): string[] {
  const reminders: string[] = [];
  reminders.push("- Google Trends 尚未自动验证，候选链接使用过去 7 天窗口。");
  const unavailable = input.sourceHealth.filter((source) => ["blocked", "partial", "unverified"].includes(source.status));
  if (unavailable.length > 0) reminders.push(`- 来源覆盖不完整：${unavailable.map((source) => source.sourceType).join("、")}。`);
  if (!input.candidates || input.candidates.formal.length === 0) reminders.push("- 今日没有满足正文和具体词门槛的候选。");
  return reminders;
}

function dataLocationLines(summary: RunSummary): string[] {
  const runDirectory = `data/runs/${summary.date}`;
  return [
    `- 原始发现池：${runDirectory}/raw-signals.jsonl`,
    `- 种子词：${runDirectory}/seed-terms.json`,
    `- 表达簇：${runDirectory}/expression-clusters.json`,
    `- 来源质量：${runDirectory}/discovery-summary.json`,
    `- 今日验证池：${runDirectory}/candidates.json`,
    `- 完整证据：${runDirectory}/evidence.json`,
  ];
}

function candidateSection(queue: CandidateQueue): string[] {
  const lines: string[] = [];
  if (queue.formal.length === 0) lines.push("- 无（当前没有满足正文上下文门槛的候选）");
  queue.formal.slice(0, DAILY_REPORT_FORMAL_LIMIT).forEach((candidate, index) => lines.push(...candidateLines(candidate, index + 1)));
  if (queue.backup.length > 0) {
    lines.push("", "## 新发现但证据不足", "");
    for (const candidate of queue.backup.slice(0, DAILY_REPORT_FORMAL_LIMIT)) lines.push(`- ${candidate.term} · ${candidate.missingFields.join("、")} · [原文](${candidate.sourceUrl})`);
  }
  return lines;
}

function candidateLines(candidate: CandidateQueue["formal"][number], index: number): string[] {
  return [
    `### ${index}. ${candidate.term}`,
    `- 用户：${excerpt(candidate.evidenceQuote ?? candidate.context, 90)} · ${candidate.authorName ?? "未知作者"} · ${candidate.publishedAt?.slice(0, 10) ?? "未知日期"}`,
    `- 证据：${excerpt(candidate.reason, 80)}${candidate.sourceCount ? ` · ${candidate.sourceCount} 个来源` : ""} · [原文](${candidate.sourceUrl}) · [Trends 7d](${candidate.trendsUrl}) · 缺少：${candidate.missingFields.join("、") || "无"}`,
  ];
}

function excerpt(value: string, limit = 240): string {
  const compact = value.replace(/[\u200B-\u200D\uFEFF]/gu, "").replace(/\s+/gu, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit).trimEnd()}…`;
}
