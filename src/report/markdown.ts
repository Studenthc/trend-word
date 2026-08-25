import type { Evidence, Expression, Opportunity, RawSignal, RunSummary, SourceHealth } from "../types.js";
import type { CandidateQueue } from "../domain/candidates.js";

export type MarkdownReportInput = {
  summary: RunSummary;
  sourceHealth: SourceHealth[];
  signals: RawSignal[];
  expressions: Expression[];
  evidence: Evidence[];
  opportunities: Opportunity[];
  candidates?: CandidateQueue;
};

export function renderMarkdownReport(input: MarkdownReportInput): string {
  const byStatus = (status: Opportunity["status"]) => input.opportunities.filter((item) => item.status === status);
  const lines = [`# 新词机会雷达 - ${input.summary.date}`, "", "## 来源健康", ""];
  for (const source of input.sourceHealth) {
    lines.push(`- ${source.sourceType}: ${source.status}（${source.itemCount} 条）`);
    for (const note of [...source.failureReasons, ...source.coverageNotes]) lines.push(`  - ${note}`);
  }
  lines.push("", "> 来源失败、阻塞或覆盖不足不等于没有新词。", "");
  if (input.candidates) lines.push(...candidateSection(input.candidates));
  lines.push("", "## 今日可行动机会", "", ...opportunityLines(byStatus("actionable")), "", "## 正在验证", "", ...opportunityLines([...byStatus("validating"), ...byStatus("watch")]), "", "## 新发现但证据不足", "", ...opportunityLines(byStatus("new")), "", "## 风险与失败", "");
  for (const source of input.sourceHealth.filter((item) => item.failureReasons.length > 0)) lines.push(`- ${source.sourceType}: ${source.failureReasons.join("；")}`);
  for (const opportunity of input.opportunities.filter((item) => item.riskFlags.length > 0)) lines.push(`- ${opportunity.title}: ${opportunity.riskFlags.join("；")}`);
  lines.push("", "## 原文证据", "");
  for (const item of input.evidence) {
    const sourceUrl = input.signals.find((signal) => signal.id === item.rawSignalId)?.sourceUrl ?? "unknown source URL";
    lines.push(`- ${item.claimType}: “${item.quote}”（${item.location}，${item.evidenceGrade}，${sourceUrl}）`);
  }
  const trendsVerified = input.opportunities.length > 0 && input.opportunities.every((item) => item.validation.trend !== "unknown");
  lines.push("", "## 覆盖范围", "", ...(trendsVerified ? [] : ["- Google Trends 未验证（可对候选进行手工 24h/7d 复核）"]), `- 来源：${input.sourceHealth.map((item) => `${item.sourceType}（${item.status}）`).join("、") || "无"}`, `- 请求来源：${input.summary.sourcesAttempted.join("、")}`, `- raw signals：${input.summary.signalCount ?? input.signals.length}`, `- expressions：${input.summary.expressionCount ?? input.expressions.length}`, `- evidence：${input.summary.evidenceCount ?? input.evidence.length}`);
  return `${lines.join("\n")}\n`;
}

function opportunityLines(items: Opportunity[]): string[] {
  return items.length === 0 ? ["- 无"] : items.map((item) => `- ${item.title}：${item.summary}`);
}

function candidateSection(queue: CandidateQueue): string[] {
  const lines = ["## Google Trends 候选（过去 7 天）", ""];
  if (queue.formal.length === 0) lines.push("- 无（当前没有满足正文上下文门槛的候选）");
  for (const candidate of queue.formal) lines.push(...candidateLines(candidate));
  lines.push("", "## 备选线索", "");
  if (queue.backup.length === 0) lines.push("- 无");
  for (const candidate of queue.backup) lines.push(`- ${candidate.term}（${candidate.reason}；缺少：${candidate.missingFields.join("、") || "无"}）`);
  return lines;
}

function candidateLines(candidate: CandidateQueue["formal"][number]): string[] {
  return [
    `- [${candidate.term}](${candidate.trendsUrl})（score ${candidate.score}）`,
    `  - ${candidate.reason}`,
    `  - 上下文：${candidate.context}`,
    `  - 来源：${candidate.authorName ?? "未知作者"}${candidate.publishedAt ? `，${candidate.publishedAt.slice(0, 10)}` : ""}，${candidate.sourceUrl}`,
  ];
}
