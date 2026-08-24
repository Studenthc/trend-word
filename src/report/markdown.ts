import type { Evidence, Expression, Opportunity, RawSignal, RunSummary, SourceHealth } from "../types.js";

export type MarkdownReportInput = {
  summary: RunSummary;
  sourceHealth: SourceHealth[];
  signals: RawSignal[];
  expressions: Expression[];
  evidence: Evidence[];
  opportunities: Opportunity[];
};

export function renderMarkdownReport(input: MarkdownReportInput): string {
  const byStatus = (status: Opportunity["status"]) => input.opportunities.filter((item) => item.status === status);
  const lines = [`# 新词机会雷达 - ${input.summary.date}`, "", "## 来源健康", ""];
  for (const source of input.sourceHealth) {
    lines.push(`- ${source.sourceType}: ${source.status}（${source.itemCount} 条）`);
    for (const note of [...source.failureReasons, ...source.coverageNotes]) lines.push(`  - ${note}`);
  }
  lines.push("", "> 来源失败、阻塞或覆盖不足不等于没有新词。", "", "## 今日可行动机会", "", ...opportunityLines(byStatus("actionable")), "", "## 正在验证", "", ...opportunityLines([...byStatus("validating"), ...byStatus("watch")]), "", "## 新发现但证据不足", "", ...opportunityLines(byStatus("new")), "", "## 风险与失败", "");
  for (const source of input.sourceHealth.filter((item) => item.failureReasons.length > 0)) lines.push(`- ${source.sourceType}: ${source.failureReasons.join("；")}`);
  for (const opportunity of input.opportunities.filter((item) => item.riskFlags.length > 0)) lines.push(`- ${opportunity.title}: ${opportunity.riskFlags.join("；")}`);
  lines.push("", "## 原文证据", "");
  for (const item of input.evidence) lines.push(`- ${item.claimType}: “${item.quote}”（${item.location}，${item.evidenceGrade}）`);
  lines.push("", "## 覆盖范围", "", `- 来源：${input.summary.sourcesAttempted.join("、")}`, `- raw signals：${input.summary.signalCount ?? input.signals.length}`, `- expressions：${input.summary.expressionCount ?? input.expressions.length}`, `- evidence：${input.summary.evidenceCount ?? input.evidence.length}`);
  return `${lines.join("\n")}\n`;
}

function opportunityLines(items: Opportunity[]): string[] {
  return items.length === 0 ? ["- 无"] : items.map((item) => `- ${item.title}：${item.summary}`);
}
