import type { Evidence, Expression, Opportunity, RawSignal, RunSummary, SourceHealth } from "../types.js";

export type RunSummaryInput = {
  date: string;
  sourcesAttempted?: string[];
  sourceHealth: SourceHealth[];
  signals: RawSignal[];
  expressions: Expression[];
  evidence: Evidence[];
  opportunities: Opportunity[];
  reportPath?: string;
};

export function summarizeRun(input: RunSummaryInput): RunSummary {
  const evidenceGradeCounts: Record<string, number> = {};
  for (const item of input.evidence) evidenceGradeCounts[item.evidenceGrade] = (evidenceGradeCounts[item.evidenceGrade] ?? 0) + 1;
  const candidateStatusCounts: Record<string, number> = {};
  for (const item of input.opportunities) candidateStatusCounts[item.status] = (candidateStatusCounts[item.status] ?? 0) + 1;
  const failedSources = input.sourceHealth.filter((item) => ["blocked", "unverified"].includes(item.status)).map((item) => item.sourceType);
  const partialSources = input.sourceHealth.filter((item) => item.status === "partial").map((item) => item.sourceType);
  const warningSources = new Set([...failedSources, ...partialSources]);
  const result: RunSummary = {
    date: input.date,
    sourcesAttempted: input.sourcesAttempted ?? input.sourceHealth.map((item) => item.sourceType),
    sourcesSucceeded: input.sourceHealth.filter((item) => item.status === "available").map((item) => item.sourceType),
    sourceHealth: input.sourceHealth,
    signalCount: input.signals.length,
    expressionCount: input.expressions.length,
    evidenceCount: input.evidence.length,
    opportunityCount: input.opportunities.length,
    evidenceGradeCounts,
    candidateStatusCounts,
    failedSources,
    partialSources,
    warningCount: warningSources.size,
    runStatus: "complete",
  };
  if (input.reportPath) result.reportPath = input.reportPath;
  return result;
}
