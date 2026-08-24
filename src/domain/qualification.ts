import type { Evidence, Expression, Opportunity, RawSignal, ValidationState } from "../types.js";
import { expressionId } from "./normalize.js";
import { mergeExpressions } from "./dedupe.js";
import { validateEvidence } from "./evidence.js";

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
};

const highRisk = /brand|medical|finance|adult|copyright|account[- ]?service|品牌|医疗|医药|金融|成人|版权|账号服务|账户服务/i;

export function qualifyOpportunity(input: QualificationInput): Opportunity {
  const signals = input.signals;
  const expressions = mergeExpressions(signals, input.previous);
  const primaryExpression = expressions[0];
  const expectedSubjectId = primaryExpression?.id;
  const checked = validateEvidence({
    evidenceIds: input.evidence.map((item) => item.id),
    evidence: input.evidence,
    rawSignals: signals,
    ...(expectedSubjectId ? { expectedSubjectId } : {}),
  });
  const evidenceIds = checked.evidence.map((item) => item.id);
  const publishers = new Set(signals.map((item) => item.sourceName));
  const claims = new Set(checked.evidence.map((item) => item.claimType));
  const riskFlags = [...new Set([
    ...(input.riskFlags ?? []),
    ...checked.evidence.filter((item) => item.claimType === "risk").map((item) => item.quote),
  ])];
  const demand = (primaryExpression?.independentPublishers ?? publishers.size) > 1 ? "cross_source" : signals.length > 1 ? "repeated" : "single_signal";
  const competition = input.competition ?? (input.supplyEvidence ? "thin" : claims.has("serp_competition") ? "mixed" : "unknown");
  const delivery = input.delivery ?? (claims.has("delivery") ? "possible" : "unknown");
  const commercial = Boolean(input.commercialEvidence || claims.has("monetization"));
  const validation: ValidationState = {
    freshness: "unknown", trend: "unknown", intent: claims.has("monetization") || claims.has("delivery") ? "commercial" : "unknown",
    demand, competition, monetization: commercial ? "observed" : "unknown", delivery,
    confidence: checked.valid && publishers.size > 1 ? "medium" : "low",
    missingChecks: [
      ...(claims.has("user_problem") || claims.has("adoption") || claims.has("search_intent") ? [] : ["demand evidence"]),
      ...(competition !== "unknown" ? [] : ["competition or supply evidence"]),
      ...(delivery !== "unknown" && delivery !== "blocked" || commercial ? [] : ["delivery or commercial evidence"]),
      ...(input.audience || (input.recommendedArtifact && input.recommendedArtifact !== "none") ? [] : ["clear audience or artifact"]),
    ],
  };
  if (!checked.valid) validation.missingChecks.push("valid evidence references");
  const blocked = riskFlags.some((flag) => highRisk.test(flag));
  const complete = checked.valid && validation.missingChecks.length === 0 && riskFlags.length === 0 && (primaryExpression?.independentPublishers ?? publishers.size) > 1;
  const status: Opportunity["status"] = blocked ? "rejected" : complete ? "actionable" : "watch";
  const primary = signals[0];
  const title = primaryExpression?.text ?? primary?.title ?? "Untitled opportunity";
  return {
    id: `opportunity-${primary?.id ?? "empty"}`, primaryExpressionId: expectedSubjectId ?? expressionId(title) ?? `expression-${primary?.id ?? "empty"}`,
    title, summary: primary?.excerpt ?? primary?.body ?? title, audiences: input.audience ? [input.audience] : [], userProblems: [],
    recommendedArtifact: input.recommendedArtifact ?? "observe", evidenceIds, validation, riskFlags,
    status, createdAt: primary?.fetchedAt ?? "", updatedAt: primary?.fetchedAt ?? "",
  };
}
