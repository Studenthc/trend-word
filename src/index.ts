import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dedupeRawSignals, mergeExpressions } from "./domain/dedupe.js";
import { expressionId, normalizeExpression } from "./domain/normalize.js";
import { qualifyOpportunity } from "./domain/qualification.js";
import { renderMarkdownReport } from "./report/markdown.js";
import { summarizeRun } from "./report/summary.js";
import { loadFixtureSignals } from "./sources/fixtures.js";
import { createGitHubAdapter, type HttpTransport as GitHubHttpTransport } from "./sources/github.js";
import { importManualSignals } from "./sources/manual.js";
import { createProductHuntAdapter, type HttpTransport as ProductHuntHttpTransport } from "./sources/producthunt.js";
import { createScysMcpAdapter, type McpTransport } from "./sources/scys-mcp.js";
import { runSafeSource } from "./sources/source.js";
import { loadConfig } from "./config.js";
import { RunStore } from "./storage/run-store.js";
import { parseSourceHealth, type Evidence, type Opportunity, type RawSignal, type RunSummary, type SourceAdapter, type SourceHealth, type SourceType } from "./types.js";

type StableSourceType = "scys-mcp" | "producthunt" | "github";
export type InjectedSourceTransports = {
  "scys-mcp"?: McpTransport;
  producthunt?: ProductHuntHttpTransport;
  github?: GitHubHttpTransport;
};

export type RadarRunOptions = {
  date: string;
  sourceNames?: string[];
  inputPath?: string;
  workspaceRoot?: string;
  transports?: InjectedSourceTransports;
  injectedTransports?: InjectedSourceTransports;
  adapters?: Partial<Record<StableSourceType, SourceAdapter>>;
};

export type RadarRunResult = {
  summary: ReturnType<typeof summarizeRun>;
  report: string;
  paths: { runDirectory: string; report: string };
};

export async function runRadar(options: RadarRunOptions): Promise<RadarRunResult> {
  try {
    return await runRadarInternal(options);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      const store = new RunStore(options.workspaceRoot ?? process.cwd(), options.date);
      const existingSummary = await store.readProjection<RunSummary>("run-summary");
      const failedSummary: RunSummary = {
        ...(existingSummary ?? {}),
        date: options.date,
        sourcesAttempted: options.sourceNames ?? ["fixtures"],
        sourceHealth: existingSummary?.sourceHealth ?? [],
        signalCount: existingSummary?.signalCount ?? 0,
        expressionCount: existingSummary?.expressionCount ?? 0,
        evidenceCount: existingSummary?.evidenceCount ?? 0,
        opportunityCount: existingSummary?.opportunityCount ?? 0,
        failedSources: existingSummary?.failedSources ?? [],
        partialSources: existingSummary?.partialSources ?? [],
        warningCount: existingSummary?.warningCount ?? 0,
        runStatus: "failed",
        failureReason: reason,
      };
      await store.writeProjection("run-summary", failedSummary);
    } catch {
      // Finalization is best effort; preserve and rethrow the original failure.
    }
    throw error;
  }
}

async function runRadarInternal(options: RadarRunOptions): Promise<RadarRunResult> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const config = await loadConfig({ workspaceRoot });
  const sourceNames = options.sourceNames ?? config.sources.required;
  const attemptedAt = new Date(`${options.date}T00:00:00.000Z`).toISOString();
  const store = new RunStore(workspaceRoot, options.date);
  const sourceContext = { workspaceRoot, fetchedAt: attemptedAt, config };
  const previousExpressions = await store.readHistoryExpressions();
  const previousOpportunities = await store.readHistory<Opportunity[]>() ?? [];
  const existingRawSignals = await store.readRawSignals();
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
        const failedCount = manualSignals.filter((item) => item.evidenceStatus === "failed").length;
        sourceHealth.push({ sourceType: "manual", status: failedCount === manualSignals.length && manualSignals.length > 0 ? "unverified" : failedCount > 0 || imported.errors.length > 0 ? "partial" : manualSignals.length > 0 ? "available" : "empty", attemptedAt, itemCount: manualSignals.length - failedCount, failureReasons: [...imported.errors.map((item) => `row ${item.row}: ${item.message}`), ...manualSignals.filter((item) => item.evidenceStatus === "failed").map((item) => item.failureReason ?? "failed signal")], coverageNotes: failedCount > 0 ? ["failed manual signal is not evidence of no new words"] : imported.errors.length > 0 ? ["manual input partially imported"] : [] });
      } catch (error) {
        configurationError = error instanceof Error ? error : new Error(String(error));
        sourceHealth.push({ sourceType: "manual", status: "blocked", attemptedAt, itemCount: 0, failureReasons: [configurationError.message], coverageNotes: ["manual input unavailable"] });
      }
    }
  }

  const injectedTransports = options.transports ?? options.injectedTransports ?? {};
  for (const sourceName of sourceNames) {
    if (!(sourceName === "scys-mcp" || sourceName === "producthunt" || sourceName === "github") || sourceHealth.some((item) => item.sourceType === sourceName)) continue;
    const adapter = stableAdapter(sourceName, options.adapters?.[sourceName], injectedTransports, config);
    if (!adapter) {
      sourceHealth.push({ sourceType: sourceName, status: "unverified", attemptedAt, itemCount: 0, failureReasons: ["no injected transport configured"], coverageNotes: ["source coverage unavailable; no implicit network request made"] });
      continue;
    }
    const collection = await runSafeSource(sourceName, adapter.collect, { context: sourceContext, attemptedAt });
    rawSignals.push(...collection.signals);
    sourceHealth.push(collection.health);
  }
  for (const sourceName of sourceNames) {
    if ((sourceName === "x-timeline" || sourceName === "reddit-feed") && !sourceHealth.some((item) => item.sourceType === sourceName)) {
      sourceHealth.push({ sourceType: sourceName, status: "unverified", attemptedAt, itemCount: 0, failureReasons: ["source adapter is not enabled in this task"], coverageNotes: ["source coverage unavailable; no implicit network request made"] });
    }
  }

  const deduped = dedupeRawSignals(rawSignals);
  const appendable = deduped.filter((candidate) => !existingRawSignals.some((existing) => dedupeRawSignals([existing, candidate]).length === 1));
  const coverageAvailable = sourceHealth.length > 0 && sourceHealth.every((item) => item.status === "available");
  const coverage = { status: sourceHealth.some((item) => ["blocked", "unverified"].includes(item.status)) ? "partial" as const : sourceHealth.some((item) => item.status !== "available") ? "partial" as const : "available" as const, coverageAvailable };
  const expressions = mergeExpressions(deduped, previousExpressions, coverage);
  const evidence: Evidence[] = [];
  for (const signal of deduped.filter((item) => item.evidenceStatus !== "failed")) {
    const text = [signal.title, signal.excerpt, signal.body].find((value) => value?.trim())?.trim();
    const subjectId = text ? expressionId(normalizeExpression(text).normalized) : undefined;
    if (!subjectId || !text) continue;
    evidence.push({ id: `evidence-${signal.id}`, subjectId, claimType: "adoption", rawSignalId: signal.id, quote: text, location: signal.title?.trim() === text ? "title" : "body", capturedAt: signal.fetchedAt, evidenceGrade: signal.evidenceStatus === "verified" ? "direct" : "reported", independentFrom: [signal.sourceType] });
  }
  const opportunities = expressions.map((expression) => qualifyOpportunity({ signals: deduped, evidence, previous: previousExpressions, expressionId: expression.id, recommendedArtifact: "tool", coverage }));
  await store.appendRawSignals(appendable);
  await store.writeProjection("expressions", expressions);
  await store.writeProjection("evidence", evidence);
  await store.writeProjection("opportunities", opportunities);
  const historyById = new Map(previousOpportunities.map((item) => [item.id, item]));
  for (const opportunity of opportunities) historyById.set(opportunity.id, opportunity);
  await store.writeHistory([...historyById.values()]);
  await store.writeHistoryExpressions(expressions);
  const baseSummary = summarizeRun({ date: options.date, sourcesAttempted: sourceNames, sourceHealth, signals: deduped, expressions, evidence, opportunities });
  const reportPath = path.join(store.runDirectory, "report.md");
  const report = renderMarkdownReport({ summary: { ...baseSummary, reportPath }, sourceHealth, signals: rawSignals, expressions, evidence, opportunities });
  await store.writeProjection("run-summary", { ...baseSummary, reportPath });
  await mkdir(store.runDirectory, { recursive: true });
  await writeFile(reportPath, report, "utf8");
  if (configurationError) throw configurationError;
  return { summary: { ...baseSummary, reportPath }, report, paths: { runDirectory: store.runDirectory, report: reportPath } };
}

function stableAdapter(sourceType: StableSourceType, supplied: SourceAdapter | undefined, transports: InjectedSourceTransports, config: Awaited<ReturnType<typeof loadConfig>>): SourceAdapter | undefined {
  if (supplied) return supplied;
  if (sourceType === "producthunt" && transports.producthunt) return createProductHuntAdapter(transports.producthunt, { limit: config.producthunt.limit });
  if (sourceType === "github" && transports.github) return createGitHubAdapter(transports.github, { queries: config.github.queries, limit: config.github.limit });
  if (sourceType === "scys-mcp" && transports["scys-mcp"]) return createScysMcpAdapter(transports["scys-mcp"], { queries: config.scys.queries });
  return undefined;
}

function healthForSignals(signals: RawSignal[], attemptedAt: string): SourceHealth[] {
  const types = [...new Set(signals.map((item) => item.sourceType))];
  return types.map((sourceType) => {
    const items = signals.filter((item) => item.sourceType === sourceType);
    const failed = items.filter((item) => item.evidenceStatus === "failed");
    return parseSourceHealth({ sourceType, status: failed.length === items.length ? "unverified" : failed.length > 0 ? "partial" : "available", attemptedAt, itemCount: items.length - failed.length, failureReasons: failed.map((item) => item.failureReason ?? "failed signal"), coverageNotes: failed.length > 0 ? ["failed source attempt is not evidence of no new words"] : [] });
  });
}
