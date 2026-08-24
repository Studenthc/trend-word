import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dedupeRawSignals, mergeExpressions } from "./domain/dedupe.js";
import { expressionId, normalizeExpression } from "./domain/normalize.js";
import { qualifyOpportunity } from "./domain/qualification.js";
import { renderMarkdownReport } from "./report/markdown.js";
import { summarizeRun } from "./report/summary.js";
import { loadFixtureSignals } from "./sources/fixtures.js";
import { importManualSignals } from "./sources/manual.js";
import { RunStore } from "./storage/run-store.js";
import { parseSourceHealth, type Evidence, type RawSignal, type SourceHealth } from "./types.js";

export type RadarRunOptions = {
  date: string;
  sourceNames?: string[];
  inputPath?: string;
  workspaceRoot?: string;
};

export type RadarRunResult = {
  summary: ReturnType<typeof summarizeRun>;
  report: string;
  paths: { runDirectory: string; report: string };
};

export async function runRadar(options: RadarRunOptions): Promise<RadarRunResult> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const sourceNames = options.sourceNames ?? ["fixtures"];
  const attemptedAt = new Date(`${options.date}T00:00:00.000Z`).toISOString();
  let rawSignals: RawSignal[] = [];
  const sourceHealth: SourceHealth[] = [];
  let configurationError: Error | undefined;

  if (sourceNames.includes("fixtures")) {
    const fixtureSignals = await loadFixtureSignals();
    rawSignals.push(...fixtureSignals);
    sourceHealth.push(...healthForSignals(fixtureSignals, attemptedAt));
  }
  if (sourceNames.includes("manual")) {
    if (!options.inputPath) {
      configurationError = new Error("manual source requires --input");
      sourceHealth.push({ sourceType: "manual", status: "blocked", attemptedAt, itemCount: 0, failureReasons: [configurationError.message], coverageNotes: ["manual input unavailable"] });
    } else {
      try {
        const content = await readFile(options.inputPath, "utf8");
        const imported = importManualSignals(content, { fetchedAt: attemptedAt });
        rawSignals.push(...imported.signals);
        const manualSignals = imported.signals.filter((item) => item.sourceType === "manual");
        sourceHealth.push({ sourceType: "manual", status: imported.errors.length > 0 ? "partial" : manualSignals.length > 0 ? "available" : "empty", attemptedAt, itemCount: manualSignals.length, failureReasons: imported.errors.map((item) => `row ${item.row}: ${item.message}`), coverageNotes: imported.errors.length > 0 ? ["manual input partially imported"] : [] });
      } catch (error) {
        configurationError = error instanceof Error ? error : new Error(String(error));
        sourceHealth.push({ sourceType: "manual", status: "blocked", attemptedAt, itemCount: 0, failureReasons: [configurationError.message], coverageNotes: ["manual input unavailable"] });
      }
    }
  }

  const deduped = dedupeRawSignals(rawSignals);
  const coverage = { status: sourceHealth.some((item) => ["blocked", "unverified"].includes(item.status)) ? "partial" as const : "available" as const, coverageAvailable: true };
  const expressions = mergeExpressions(deduped, [], coverage);
  const evidence: Evidence[] = [];
  for (const signal of deduped.filter((item) => item.evidenceStatus !== "failed")) {
    const text = [signal.title, signal.excerpt, signal.body].find((value) => value?.trim())?.trim();
    const subjectId = text ? expressionId(normalizeExpression(text).normalized) : undefined;
    if (!subjectId || !text) continue;
    evidence.push({ id: `evidence-${signal.id}`, subjectId, claimType: "adoption", rawSignalId: signal.id, quote: text, location: signal.title?.trim() === text ? "title" : "body", capturedAt: signal.fetchedAt, evidenceGrade: signal.evidenceStatus === "verified" ? "direct" : "reported", independentFrom: [signal.sourceType] });
  }
  const opportunities = expressions.map((expression) => qualifyOpportunity({ signals: deduped, evidence, previous: [], expressionId: expression.id, recommendedArtifact: "tool", coverage }));
  const store = new RunStore(workspaceRoot, options.date);
  await store.appendRawSignals(rawSignals);
  await store.writeProjection("expressions", expressions);
  await store.writeProjection("evidence", evidence);
  await store.writeProjection("opportunities", opportunities);
  await store.writeHistory(opportunities);
  const baseSummary = summarizeRun({ date: options.date, sourcesAttempted: sourceNames, sourceHealth, signals: rawSignals, expressions, evidence, opportunities });
  const reportPath = path.join(store.runDirectory, "report.md");
  const report = renderMarkdownReport({ summary: { ...baseSummary, reportPath }, sourceHealth, signals: rawSignals, expressions, evidence, opportunities });
  await store.writeProjection("run-summary", { ...baseSummary, reportPath });
  await mkdir(store.runDirectory, { recursive: true });
  await writeFile(reportPath, report, "utf8");
  if (configurationError) throw configurationError;
  return { summary: { ...baseSummary, reportPath }, report, paths: { runDirectory: store.runDirectory, report: reportPath } };
}

function healthForSignals(signals: RawSignal[], attemptedAt: string): SourceHealth[] {
  const types = [...new Set(signals.map((item) => item.sourceType))];
  return types.map((sourceType) => {
    const items = signals.filter((item) => item.sourceType === sourceType);
    const failed = items.filter((item) => item.evidenceStatus === "failed");
    return parseSourceHealth({ sourceType, status: failed.length === items.length ? "unverified" : failed.length > 0 ? "partial" : "available", attemptedAt, itemCount: items.length - failed.length, failureReasons: failed.map((item) => item.failureReason ?? "failed signal"), coverageNotes: failed.length > 0 ? ["failed source attempt is not evidence of no new words"] : [] });
  });
}
