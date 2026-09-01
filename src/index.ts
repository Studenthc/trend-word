import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dedupeRawSignals, mergeExpressions } from "./domain/dedupe.js";
import { buildCandidateQueue } from "./domain/candidates.js";
import { extractSeedTerms } from "./domain/seed-terms.js";
import { extractDemandExpressions } from "./domain/demand-expressions.js";
import { clusterSeedTerms } from "./domain/expression-clusters.js";
import { expressionId, normalizeExpression } from "./domain/normalize.js";
import { qualifyOpportunity } from "./domain/qualification.js";
import { renderMarkdownReport } from "./report/markdown.js";
import { summarizeRun } from "./report/summary.js";
import { loadFixtureSignals } from "./sources/fixtures.js";
import { createGitHubAdapter, type HttpTransport as GitHubHttpTransport } from "./sources/github.js";
import { importManualSignals } from "./sources/manual.js";
import { createProductHuntAdapter, type HttpTransport as ProductHuntHttpTransport } from "./sources/producthunt.js";
import { createScysMcpAdapter, type McpTransport } from "./sources/scys-mcp.js";
import { createXTimelineAdapter, type HttpTransport as XTimelineHttpTransport } from "./sources/x-timeline.js";
import { createRedditFeedAdapter, type HttpTransport as RedditHttpTransport } from "./sources/reddit-feed.js";
import { createHttpTransport, createProductHuntGraphqlTransport, createRedditFallbackTransport, createXApiTransport } from "./sources/http.js";
import { runSafeSource } from "./sources/source.js";
import { enrichSignalsWithDetails, type DetailResult } from "./sources/details.js";
import { enrichSignalsWithFeedback, isFeedbackSignal, type FeedbackEnrichmentResult } from "./sources/feedback.js";
import { loadConfig } from "./config.js";
import { RunStore } from "./storage/run-store.js";
import { readCandidateFeedback } from "./storage/feedback-store.js";
import { parseSourceHealth, type DiscoverySummary, type Evidence, type Opportunity, type RawSignal, type RunSummary, type SourceAdapter, type SourceHealth, type SourceRole, type SourceType, type TrendVerification } from "./types.js";

type StableSourceType = "scys-mcp" | "producthunt" | "github" | "x-timeline" | "reddit-feed";
export type InjectedSourceTransports = {
  "scys-mcp"?: McpTransport;
  producthunt?: ProductHuntHttpTransport;
  github?: GitHubHttpTransport;
  "x-timeline"?: XTimelineHttpTransport;
  "reddit-feed"?: RedditHttpTransport;
  xTimeline?: XTimelineHttpTransport;
  redditFeed?: RedditHttpTransport;
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
  candidates?: ReturnType<typeof buildCandidateQueue>;
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
  const sourceNames = options.sourceNames ?? defaultSourceNames(config);
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
    if (!(sourceName === "scys-mcp" || sourceName === "producthunt" || sourceName === "github" || sourceName === "x-timeline" || sourceName === "reddit-feed") || sourceHealth.some((item) => item.sourceType === sourceName)) continue;
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

  const detailTransports = {
    ...(injectedTransports.github || (implicitNetworkEnabled() && (process.env.RADAR_GITHUB_TOKEN || publicHttpEnabled())) ? { github: injectedTransports.github ?? createHttpTransport({ bearerEnv: "RADAR_GITHUB_TOKEN" }) } : {}),
    ...(injectedTransports.producthunt || (implicitNetworkEnabled() && process.env.PRODUCT_HUNT_API_TOKEN) ? { producthunt: injectedTransports.producthunt ?? createHttpTransport({ bearerEnv: "PRODUCT_HUNT_API_TOKEN" }) } : {}),
  };
  const detailEnrichment = await enrichSignalsWithDetails(rawSignals, detailTransports, workspaceRoot, attemptedAt);
  const feedbackEnrichment = await enrichSignalsWithFeedback(detailEnrichment.signals, detailTransports, workspaceRoot, attemptedAt, 20);
  rawSignals = feedbackEnrichment.signals;
  const deduped = dedupeRawSignals(rawSignals);
  const seedTerms = deduped.flatMap((signal) => extractSeedTerms(signal));
  const demandExpressions = deduped.flatMap((signal) => extractDemandExpressions(signal));
  const clusters = clusterSeedTerms(seedTerms, deduped, attemptedAt);
  const sourceRoles = buildSourceRoles(config.sources);
  const candidates = buildCandidateQueue(deduped, { now: attemptedAt, region: config.googleTrends.region, feedback: await readCandidateFeedback(workspaceRoot), seedTerms, clusters, demandExpressions, previousExpressions, sourceRoles });
  const reportCandidates = attachTrendVerifications(candidates, await store.readProjection<TrendVerification[]>("trend-verifications") ?? []);
  const discoverySummary = buildDiscoverySummary(options.date, deduped, sourceHealth, reportCandidates, demandExpressions, detailEnrichment.results, feedbackEnrichment.results);
  await store.writeDiscoverySummary(discoverySummary);
  const appendable = deduped.filter((candidate) => !existingRawSignals.some((existing) => dedupeRawSignals([existing, candidate]).length === 1));
  const coverageAvailable = sourceHealth.length > 0 && sourceHealth.every((item) => item.status === "available");
  const coverage = { status: sourceHealth.some((item) => ["blocked", "unverified"].includes(item.status)) ? "partial" as const : sourceHealth.some((item) => item.status !== "available") ? "partial" as const : "available" as const, coverageAvailable };
  const expressions = mergeExpressions(deduped, previousExpressions, coverage);
  const evidence: Evidence[] = [];
  for (const seed of seedTerms) {
    evidence.push({ id: `evidence-${seed.id}`, subjectId: expressionId(seed.normalizedText) ?? `expression-${seed.id}`, claimType: seed.kind === "problem" ? "user_problem" : seed.location === "metadata" ? "adoption" : "search_intent", rawSignalId: seed.rawSignalId, quote: seed.quote, location: seed.location === "excerpt" ? "body" : seed.location === "tag" ? "metadata" : seed.location, capturedAt: seed.firstSeenAt, evidenceGrade: deduped.find((signal) => signal.id === seed.rawSignalId)?.evidenceStatus === "verified" ? "direct" : "reported", independentFrom: [seed.sourceType] });
  }
  for (const demand of demandExpressions) {
    const source = deduped.find((signal) => signal.id === demand.rawSignalId);
    evidence.push({ id: `evidence-${demand.id}`, subjectId: demand.id, claimType: demand.type === "pain" ? "user_problem" : "search_intent", rawSignalId: demand.rawSignalId, quote: demand.evidenceQuote, location: demand.evidenceLocation === "excerpt" ? "body" : demand.evidenceLocation, capturedAt: demand.firstSeenAt, evidenceGrade: demand.evidenceGrade, independentFrom: [demand.sourceType], notes: `${demand.origin}; ${demand.transformation}${source?.parentSignalId ? `; parent=${source.parentSignalId}` : ""}` });
  }
  const opportunities = expressions.map((expression) => qualifyOpportunity({ signals: deduped, evidence, previous: previousExpressions, expressionId: expression.id, recommendedArtifact: "tool", coverage }));
  await store.appendRawSignals(appendable);
  await store.writeProjection("expressions", expressions);
  await store.writeProjection("seed-terms", seedTerms);
  await store.writeProjection("demand-expressions", demandExpressions);
  await store.writeProjection("expression-clusters", clusters);
  await store.writeProjection("evidence", evidence);
  await store.writeProjection("opportunities", opportunities);
  const historyById = new Map(previousOpportunities.map((item) => [item.id, item]));
  for (const opportunity of opportunities) historyById.set(opportunity.id, opportunity);
  await store.writeHistory([...historyById.values()]);
  await store.writeHistoryExpressions(expressions);
  const baseSummary = summarizeRun({ date: options.date, sourcesAttempted: sourceNames, sourceHealth, signals: deduped, expressions, evidence, opportunities });
  const reportPath = path.join(store.runDirectory, "report.md");
  const report = renderMarkdownReport({ summary: { ...baseSummary, reportPath }, sourceHealth, signals: rawSignals, expressions, evidence, opportunities, candidates: reportCandidates, discoverySummary, sourceRoles });
  await store.writeProjection("run-summary", { ...baseSummary, reportPath });
  await mkdir(store.runDirectory, { recursive: true });
  await writeFile(reportPath, report, "utf8");
  await writeFile(path.join(store.runDirectory, "candidates.json"), JSON.stringify(reportCandidates, null, 2), "utf8");
  if (configurationError) throw configurationError;
  return { summary: { ...baseSummary, reportPath }, report, candidates: reportCandidates, paths: { runDirectory: store.runDirectory, report: reportPath } };
}

function attachTrendVerifications(queue: ReturnType<typeof buildCandidateQueue>, verifications: TrendVerification[]): ReturnType<typeof buildCandidateQueue> {
  const latest = new Map<string, TrendVerification>();
  for (const verification of verifications) {
    const previous = latest.get(verification.candidateId);
    if (!previous || Date.parse(verification.checkedAt) >= Date.parse(previous.checkedAt)) latest.set(verification.candidateId, verification);
  }
  const attach = (candidate: ReturnType<typeof buildCandidateQueue>["formal"][number]) => {
    const trendVerification = latest.get(candidate.candidateId);
    return trendVerification ? { ...candidate, trendVerification } : candidate;
  };
  return { formal: queue.formal.map(attach), backup: queue.backup.map(attach) };
}

function defaultSourceNames(config: Awaited<ReturnType<typeof loadConfig>>): string[] {
  return [...new Set([...config.sources.required, ...config.sources.bestEffort, ...config.sources.validation])];
}

function buildSourceRoles(sources: { required: SourceType[]; bestEffort: SourceType[]; validation: SourceType[] }): Partial<Record<SourceType, SourceRole>> {
  const roles: Partial<Record<SourceType, SourceRole>> = {};
  for (const sourceType of [...sources.required, ...sources.bestEffort]) roles[sourceType] = "discovery";
  for (const sourceType of sources.validation) roles[sourceType] = "validation";
  return roles;
}

function stableAdapter(sourceType: StableSourceType, supplied: SourceAdapter | undefined, transports: InjectedSourceTransports, config: Awaited<ReturnType<typeof loadConfig>>): SourceAdapter | undefined {
  if (supplied) return supplied;
  if (sourceType === "producthunt" && (transports.producthunt || (implicitNetworkEnabled() && process.env.PRODUCT_HUNT_API_TOKEN))) return createProductHuntAdapter(transports.producthunt ?? createProductHuntGraphqlTransport(), { limit: config.producthunt.limit });
  if (sourceType === "github" && (transports.github || publicHttpEnabled())) return createGitHubAdapter(transports.github ?? createHttpTransport({ bearerEnv: "RADAR_GITHUB_TOKEN" }), { queries: config.github.queries, limit: config.github.limit });
  if (sourceType === "scys-mcp" && transports["scys-mcp"]) return createScysMcpAdapter(transports["scys-mcp"], { queries: config.scys.queries });
  const xTransport = transports["x-timeline"] ?? transports.xTimeline;
  if (sourceType === "x-timeline" && (xTransport || (implicitNetworkEnabled() && process.env.X_BEARER_TOKEN))) return createXTimelineAdapter(xTransport ?? createXApiTransport(), { handles: config.xTimeline.handles });
  const redditTransport = transports["reddit-feed"] ?? transports.redditFeed;
  if (sourceType === "reddit-feed" && (redditTransport || publicHttpEnabled())) return createRedditFeedAdapter(redditTransport ?? createRedditFallbackTransport({ tokenEnv: "REDDIT_ACCESS_TOKEN" }), { communities: config.redditFeed.communities, ...(redditTransport ? {} : { baseUrl: "https://www.reddit.com" }) });
  return undefined;
}

function publicHttpEnabled(): boolean {
  return process.env.RADAR_ENABLE_PUBLIC_HTTP === "1" && implicitNetworkEnabled();
}

function implicitNetworkEnabled(): boolean {
  return process.env.NODE_ENV !== "test" && !process.env.VITEST && !process.argv.some((argument) => argument.toLowerCase().includes("vitest"));
}

function healthForSignals(signals: RawSignal[], attemptedAt: string): SourceHealth[] {
  const types = [...new Set(signals.map((item) => item.sourceType))];
  return types.map((sourceType) => {
    const items = signals.filter((item) => item.sourceType === sourceType);
    const failed = items.filter((item) => item.evidenceStatus === "failed");
    return parseSourceHealth({ sourceType, status: failed.length === items.length ? "unverified" : failed.length > 0 ? "partial" : "available", attemptedAt, itemCount: items.length - failed.length, failureReasons: failed.map((item) => item.failureReason ?? "failed signal"), coverageNotes: failed.length > 0 ? ["failed source attempt is not evidence of no new words"] : [] });
  });
}

function buildDiscoverySummary(date: string, signals: RawSignal[], sourceHealth: SourceHealth[], candidates: ReturnType<typeof buildCandidateQueue>, demandExpressions: import("./types.js").DemandExpression[] = [], detailResults: DetailResult[] = [], feedbackResults: FeedbackEnrichmentResult[] = []): DiscoverySummary {
  const runAt = Date.parse(`${date}T00:00:00.000Z`);
  const formalBySignal = countCandidatesBySignal(candidates.formal);
  const backupBySignal = countCandidatesBySignal(candidates.backup);
  return {
    date,
    totalRawSignals: signals.length,
    verificationPoolCount: candidates.formal.length,
    entityCount: signals.filter((signal) => !isFeedbackSignal(signal)).length,
    detailAttempted: detailResults.length,
    detailSucceeded: detailResults.filter((detail) => detail.status === "success").length,
    detailEmpty: detailResults.filter((detail) => detail.status === "empty").length,
    detailFailed: detailResults.filter((detail) => detail.status === "failed").length,
    demandExpressionCount: demandExpressions.length,
    directDemandCount: demandExpressions.filter((item) => item.origin === "user_evidence" && (item.evidencePrecision ?? (item.transformation === "保留原文需求表达" ? "exact" : "inferred")) !== "inferred").length,
    capabilityDerivedCount: demandExpressions.filter((item) => item.origin === "capability_derived").length,
    inferredDemandCount: demandExpressions.filter((item) => (item.evidencePrecision ?? (item.transformation === "保留原文需求表达" ? "exact" : item.origin === "capability_derived" ? "semantic" : "inferred")) === "inferred").length,
    qualityRejectedCount: 0,
    formalDemandCount: candidates.formal.filter((candidate) => candidate.candidateId.startsWith("candidate-demand-")).length,
    feedbackAttempted: feedbackResults.length,
    feedbackSucceeded: feedbackResults.filter((item) => item.result.status === "success").length,
    feedbackUnavailable: feedbackResults.filter((item) => item.result.status === "unavailable").length,
    sourceQuality: sourceHealth.map((health) => {
      const sourceSignals = signals.filter((signal) => signal.sourceType === health.sourceType);
      const feedbackCount = sourceSignals.filter(isFeedbackSignal).length;
      return {
        sourceType: health.sourceType,
        status: health.status,
        rawCount: sourceSignals.length,
        bodyCount: sourceSignals.filter((signal) => Boolean(signal.body?.trim() || signal.excerpt?.trim())).length,
        freshCount: sourceSignals.filter((signal) => isFreshSignal(signal.publishedAt, runAt)).length,
        formalCandidateCount: sourceSignals.reduce((count, signal) => count + (formalBySignal.get(signal.id) ?? 0), 0),
        backupCandidateCount: sourceSignals.reduce((count, signal) => count + (backupBySignal.get(signal.id) ?? 0), 0),
        feedbackCount,
        failureReasons: [...health.failureReasons],
      };
    }),
  };
}

function countCandidatesBySignal(items: ReturnType<typeof buildCandidateQueue>["formal"]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.sourceSignalId, (counts.get(item.sourceSignalId) ?? 0) + 1);
  return counts;
}

function isFreshSignal(publishedAt: string | undefined, runAt: number): boolean {
  if (!publishedAt) return false;
  const timestamp = Date.parse(publishedAt);
  return Number.isFinite(timestamp) && timestamp >= runAt - 7 * 86_400_000 && timestamp <= runAt + 86_400_000;
}
