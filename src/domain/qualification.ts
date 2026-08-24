import type { Evidence, Expression, Opportunity, RawSignal, ValidationState } from "../types.js";
import { validateEvidence } from "./evidence.js";

export type QualificationInput = {
  signals: RawSignal[];
  evidence: Evidence[];
  previous: Expression[];
  audience?: string;
  recommendedArtifact?: Opportunity["recommendedArtifact"];
  riskFlags?: string[];
};

const highRisk = /brand|medical|finance|adult|copyright|account[- ]?service/i;

export function qualifyOpportunity(input: QualificationInput): Opportunity {
  const signals = input.signals;
  const evidenceIds = input.evidence.map((item) => item.id);
  const checked = validateEvidence({ evidenceIds, evidence: input.evidence, rawSignals: signals });
  const publishers = new Set(signals.map((item) => item.sourceName));
  const claims = new Set(checked.evidence.map((item) => item.claimType));
  const riskFlags = input.riskFlags ?? checked.evidence.filter((item) => item.claimType === "risk").map((item) => item.quote);
  const demand = publishers.size > 1 ? "cross_source" : signals.length > 1 ? "repeated" : "single_signal";
  const validation: ValidationState = {
    freshness: "unknown", trend: "unknown", intent: claims.has("monetization") || claims.has("delivery") ? "commercial" : "unknown",
    demand, competition: claims.has("serp_competition") ? "mixed" : "unknown",
    monetization: claims.has("monetization") ? "observed" : "unknown", delivery: claims.has("delivery") ? "possible" : "unknown",
    confidence: checked.valid && publishers.size > 1 ? "medium" : "low",
    missingChecks: [
      ...(claims.has("user_problem") || claims.has("adoption") || claims.has("search_intent") ? [] : ["demand evidence"]),
      ...(claims.has("serp_competition") ? [] : ["competition or supply evidence"]),
      ...(claims.has("delivery") || claims.has("monetization") ? [] : ["delivery or commercial evidence"]),
      ...(input.audience || (input.recommendedArtifact && input.recommendedArtifact !== "none") ? [] : ["clear audience or artifact"]),
    ],
  };
  if (!checked.valid) validation.missingChecks.push("valid evidence references");
  const blocked = riskFlags.some((flag) => highRisk.test(flag));
  const complete = checked.valid && validation.missingChecks.length === 0 && riskFlags.length === 0 && publishers.size > 1;
  const status: Opportunity["status"] = blocked ? "rejected" : complete ? "actionable" : "watch";
  const primary = signals[0];
  const title = primary?.title ?? "Untitled opportunity";
  return {
    id: `opportunity-${primary?.id ?? "empty"}`, primaryExpressionId: `expression-${title.toLocaleLowerCase("en-US")}`,
    title, summary: primary?.excerpt ?? primary?.body ?? title, audiences: input.audience ? [input.audience] : [], userProblems: [],
    recommendedArtifact: input.recommendedArtifact ?? "observe", evidenceIds, validation, riskFlags,
    status, createdAt: primary?.fetchedAt ?? "", updatedAt: primary?.fetchedAt ?? "",
  };
}
