import type { Evidence, Expression, Opportunity, RawSignal, ValidationState } from "../types.js";
import { expressionId, normalizeExpression } from "./normalize.js";
import { dedupeRawSignals, mergeExpressions } from "./dedupe.js";
import { validateEvidence } from "./evidence.js";
import { canonicalTimestamp, type SourceCoverage } from "./lifecycle.js";

export type QualificationInput = {
  signals: RawSignal[];
  evidence: Evidence[];
  previous: Expression[];
  audience?: string;
  recommendedArtifact?: Opportunity["recommendedArtifact"];
  riskFlags?: string[];
  competition?: "thin" | "mixed" | "strong";
  supplyEvidence?: boolean;
  delivery?: "possible" | "quick_mvp" | "blocked";
  commercialEvidence?: boolean;
  expressionId?: string;
  candidateExpressionId?: string;
  coverage: SourceCoverage;
};

const highRisk = /brand|medical|finance|adult|copyright|account[- ]?service|品牌|医疗|医药|金融|成人|版权|账号服务|账户服务/i;

function usableText(signal: RawSignal): string | undefined {
  return [signal.title, signal.excerpt, signal.body].find((value) => value?.trim())?.trim();
}

function signalExpression(signal: RawSignal): string | undefined {
  const text = usableText(signal);
  return text ? normalizeExpression(text).normalized : undefined;
}

export function qualifyOpportunity(input: QualificationInput): Opportunity {
  const signals = input.signals;
  const projectionSignals = dedupeRawSignals(signals).filter((signal) => signal.evidenceStatus !== "failed");
  const expressions = mergeExpressions(projectionSignals, input.previous, input.coverage);
  const requestedExpressionId = input.expressionId ?? input.candidateExpressionId;
  if (!requestedExpressionId && expressions.length > 1) throw new Error("qualification requires an expression id for multiple expressions");
  const primaryExpression = requestedExpressionId ? expressions.find((item) => item.id === requestedExpressionId) : expressions[0];
  if (requestedExpressionId && !primaryExpression) throw new Error(`unknown expression id ${requestedExpressionId}`);
  const expectedSubjectId = primaryExpression?.id;
  const candidateSignals = primaryExpression ? projectionSignals.filter((signal) => signalExpression(signal) === primaryExpression.normalizedText) : [];
  const candidateRawSignalIds = primaryExpression ? candidateSignals.map((signal) => signal.id) : undefined;
  const checked = validateEvidence({
    evidenceIds: input.evidence.map((item) => item.id),
    evidence: input.evidence,
    rawSignals: projectionSignals,
    ...(expectedSubjectId ? { expectedSubjectId } : {}),
    ...(candidateRawSignalIds ? { expectedRawSignalIds: candidateRawSignalIds } : {}),
  });
  const evidenceIds = checked.evidence.map((item) => item.id);
  const claims = new Set(checked.evidence.map((item) => item.claimType));
  const riskFlags = [...new Set([
    ...(input.riskFlags ?? []),
    ...checked.evidence.filter((item) => item.claimType === "risk").map((item) => item.quote),
  ])];
  const candidateClusters = new Map<string, RawSignal>();
  for (const signal of candidateSignals) {
    const cluster = signal.sourceFingerprint.trim() || signal.id;
    if (!candidateClusters.has(cluster)) candidateClusters.set(cluster, signal);
  }
  const candidateIndependentPublishers = new Set([...candidateClusters.values()].map((signal) => signal.sourceType)).size;
  const demand = candidateIndependentPublishers > 1 ? "cross_source" : candidateSignals.length > 1 ? "repeated" : "single_signal";
  const evidenceSourceTypes = new Set(checked.evidence.map((item) => candidateSignals.find((signal) => signal.id === item.rawSignalId)?.sourceType).filter((value): value is RawSignal["sourceType"] => Boolean(value)));
  const independentDemandEvidence = demand !== "cross_source" || evidenceSourceTypes.size >= 2;
  const competition = input.competition ?? (input.supplyEvidence ? "thin" : claims.has("serp_competition") ? "mixed" : "unknown");
  const delivery = input.delivery ?? (claims.has("delivery") ? "possible" : "unknown");
  const commercial = Boolean(input.commercialEvidence || claims.has("monetization"));
  const validation: ValidationState = {
    freshness: "unknown", trend: "unknown", intent: claims.has("monetization") || claims.has("delivery") ? "commercial" : "unknown",
    demand, competition, monetization: commercial ? "observed" : "unknown", delivery,
    confidence: checked.valid && candidateIndependentPublishers > 1 ? "medium" : "low",
    missingChecks: [
      ...(claims.has("user_problem") || claims.has("adoption") || claims.has("search_intent") ? [] : ["demand evidence"]),
      ...(!independentDemandEvidence ? ["demand evidence"] : []),
      ...(competition !== "unknown" ? [] : ["competition or supply evidence"]),
      ...(delivery === "blocked" || (delivery === "unknown" && !commercial) ? ["delivery or commercial evidence"] : []),
      ...(input.audience || (input.recommendedArtifact && input.recommendedArtifact !== "none") ? [] : ["clear audience or artifact"]),
    ],
  };
  if (!checked.valid) validation.missingChecks.push("valid evidence references");
  const blocked = riskFlags.some((flag) => highRisk.test(flag));
  const complete = checked.valid && validation.missingChecks.length === 0 && delivery !== "blocked" && riskFlags.length === 0 && independentDemandEvidence && candidateIndependentPublishers > 1;
  const status: Opportunity["status"] = blocked ? "rejected" : complete ? "actionable" : "watch";
  const representative = candidateSignals[0];
  const title = representative ? usableText(representative) ?? "Unknown opportunity" : primaryExpression?.text ?? "Unknown opportunity";
  const createdAt = representative ? canonicalTimestamp(representative.fetchedAt) ?? (representative.publishedAt ? canonicalTimestamp(representative.publishedAt) : undefined) ?? "unknown" : "unknown";
  const updatedAt = candidateSignals.map((signal) => canonicalTimestamp(signal.fetchedAt) ?? (signal.publishedAt ? canonicalTimestamp(signal.publishedAt) : undefined)).filter((value): value is string => Boolean(value)).sort().at(-1) ?? createdAt;
  const summary = representative ? [representative.excerpt, representative.body, representative.title].find((value) => value?.trim())?.trim() ?? title : title;
  return {
    id: `opportunity-${representative?.id ?? expectedSubjectId ?? "empty"}`, primaryExpressionId: expectedSubjectId ?? expressionId(title) ?? `expression-${representative?.id ?? "empty"}`,
    title, summary, audiences: input.audience ? [input.audience] : [], userProblems: [],
    recommendedArtifact: input.recommendedArtifact ?? "observe", evidenceIds, validation, riskFlags,
    status, createdAt, updatedAt,
  };
}
