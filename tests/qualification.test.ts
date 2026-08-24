import { describe, expect, it } from "vitest";
import type { Evidence, RawSignal } from "../src/types.js";
import { expressionId, normalizeExpression } from "../src/domain/normalize.js";
import { qualifyOpportunity } from "../src/domain/qualification.js";

export function productHuntSignalFixture(): RawSignal {
  return {
    id: "product-hunt-1", sourceType: "producthunt", sourceName: "Product Hunt", sourceUrl: "https://producthunt.com/posts/ai-workflow",
    externalId: "ph-1", title: "AI Workflow", body: "A new AI workflow product for creators", author: { name: "Publisher" },
    fetchedAt: "2026-08-24T00:00:00.000Z", sourceTier: "market", sourceFingerprint: "ph-1", evidenceStatus: "verified",
  };
}

export function directEvidenceFor(subjectId: string): Evidence {
  return {
    id: "evidence-1", subjectId, claimType: "adoption", rawSignalId: "product-hunt-1", quote: "A new AI workflow product",
    location: "body", capturedAt: "2026-08-24T00:00:00.000Z", evidenceGrade: "direct", independentFrom: ["Product Hunt"],
  };
}

describe("qualifyOpportunity", () => {
  it("does not qualify a product-name signal from one publisher", () => {
    const signal = productHuntSignalFixture();
    const duplicate = { ...signal, id: "duplicate", author: { name: "Another author" } };
    const result = qualifyOpportunity({ signals: [signal, duplicate], evidence: [directEvidenceFor(expressionId(normalizeExpression("AI Workflow").normalized)!)], previous: [], coverage: { status: "available" } });
    expect(result.status).toBe("watch");
    expect(result.validation.demand).toBe("single_signal");
  });

  it("requires demand, supply, delivery, audience, and risk clearance before actionable", () => {
    const signal = productHuntSignalFixture();
    const signals = [signal, { ...signal, id: "github-1", sourceType: "github" as const, sourceName: "GitHub", sourceUrl: "https://github.com/example/repo", sourceFingerprint: "github-1", author: { name: "Developer" } }];
    const evidence = [
      directEvidenceFor(expressionId(normalizeExpression("AI Workflow").normalized)!),
      { ...directEvidenceFor(expressionId(normalizeExpression("AI Workflow").normalized)!), id: "competition", claimType: "serp_competition" as const, rawSignalId: "github-1" },
      { ...directEvidenceFor(expressionId(normalizeExpression("AI Workflow").normalized)!), id: "delivery", claimType: "delivery" as const, rawSignalId: "github-1" },
      { ...directEvidenceFor(expressionId(normalizeExpression("AI Workflow").normalized)!), id: "audience", claimType: "user_problem" as const, rawSignalId: "github-1" },
    ];
    const result = qualifyOpportunity({ signals, evidence, previous: [], audience: "AI creators", recommendedArtifact: "tool", competition: "mixed", delivery: "quick_mvp", commercialEvidence: true, coverage: { status: "available" } });
    expect(result.status).toBe("actionable");
    expect(result.primaryExpressionId).toBe(expressionId(normalizeExpression("AI Workflow").normalized));
    expect(result.evidenceIds).toEqual(evidence.map((item) => item.id));
  });

  it("downgrades brand risk instead of treating it as actionable", () => {
    const result = qualifyOpportunity({ signals: [productHuntSignalFixture()], evidence: [directEvidenceFor(expressionId(normalizeExpression("AI Workflow").normalized)!)], previous: [], riskFlags: ["品牌风险"], coverage: { status: "available" } });
    expect(result.status).toBe("rejected");
  });

  it("removes invalid evidence ids and evaluates explicit supply and commercial gates", () => {
    const signal = productHuntSignalFixture();
    const valid = directEvidenceFor(expressionId(normalizeExpression("AI Workflow").normalized)!);
    const result = qualifyOpportunity({ signals: [signal], evidence: [{ ...valid, id: "bad", rawSignalId: "missing" }, valid], previous: [], supplyEvidence: true, commercialEvidence: true, audience: "creators", recommendedArtifact: "tool", coverage: { status: "available" } });
    expect(result.status).toBe("watch");
    expect(result.evidenceIds).toEqual([valid.id]);
    expect(result.validation.missingChecks).toContain("valid evidence references");
  });

  it.each(["medical", "金融", "成人", "版权", "account service"]) ("rejects high risk flag %s", (risk) => {
    const result = qualifyOpportunity({ signals: [productHuntSignalFixture()], evidence: [], previous: [], riskFlags: [risk], coverage: { status: "available" } });
    expect(result.status).toBe("rejected");
  });

  it("does not suppress a risk claim with an empty explicit risk list", () => {
    const signal = productHuntSignalFixture();
    const subjectId = expressionId(normalizeExpression(signal.title ?? "").normalized)!;
    const risk = { ...directEvidenceFor(subjectId), id: "risk", claimType: "risk" as const, quote: "medical service" };
    const result = qualifyOpportunity({ signals: [signal], evidence: [risk], previous: [], riskFlags: [], coverage: { status: "available" } });
    expect(result.status).toBe("rejected");
  });

  it("qualifies the explicitly selected expression instead of the first expression", () => {
    const first = productHuntSignalFixture();
    const second = { ...first, id: "second", title: "Creator Billing", excerpt: "Creator billing excerpt", body: "Creator billing body", sourceUrl: "https://producthunt.com/posts/creator-billing", externalId: "ph-2", fetchedAt: "2026-08-25T00:00:00.000Z" };
    const selectedId = expressionId(normalizeExpression(second.title).normalized)!;
    const evidence = [
      { ...directEvidenceFor(selectedId), id: "demand", claimType: "adoption" as const, rawSignalId: second.id },
      { ...directEvidenceFor(selectedId), id: "supply", claimType: "serp_competition" as const, rawSignalId: second.id },
      { ...directEvidenceFor(selectedId), id: "delivery", claimType: "delivery" as const, rawSignalId: second.id },
      { ...directEvidenceFor(selectedId), id: "wrong-candidate", rawSignalId: first.id },
    ];
    const result = qualifyOpportunity({ signals: [first, second], evidence, previous: [], expressionId: selectedId, audience: "creators", recommendedArtifact: "tool", delivery: "possible", coverage: { status: "available" } });
    expect(result.primaryExpressionId).toBe(selectedId);
    expect(result.title).toBe("Creator Billing");
    expect(result.summary).toBe("Creator billing excerpt");
    expect(result.id).toBe("opportunity-second");
    expect(result.createdAt).toBe("2026-08-25T00:00:00.000Z");
    expect(result.updatedAt).toBe("2026-08-25T00:00:00.000Z");
    expect(result.evidenceIds).toEqual(["demand", "supply", "delivery"]);
  });

  it("does not qualify an ambiguous multi-expression input without a selected id", () => {
    expect(() => qualifyOpportunity({ signals: [productHuntSignalFixture(), { ...productHuntSignalFixture(), id: "other", title: "Other Product", externalId: "ph-other", sourceUrl: "https://example.com/other" }], evidence: [], previous: [], coverage: { status: "available" } })).toThrow(/expression id/i);
  });

  it("blocks actionable status when delivery is explicitly blocked", () => {
    const signal = productHuntSignalFixture();
    const id = expressionId(normalizeExpression(signal.title ?? "").normalized)!;
    const result = qualifyOpportunity({ signals: [signal, { ...signal, id: "github", sourceType: "github", sourceName: "GitHub", sourceUrl: "https://github.com/example" }], evidence: [directEvidenceFor(id)], previous: [], expressionId: id, competition: "mixed", delivery: "blocked", commercialEvidence: true, audience: "creators", recommendedArtifact: "tool", coverage: { status: "available" } });
    expect(result.status).toBe("watch");
    expect(result.validation.delivery).toBe("blocked");
    expect(result.validation.missingChecks).toContain("delivery or commercial evidence");
  });

  it("requires independent validated evidence for cross-source demand", () => {
    const first = productHuntSignalFixture();
    const second = { ...first, id: "github", sourceType: "github" as const, sourceName: "GitHub", sourceUrl: "https://github.com/example", sourceFingerprint: "github" };
    const id = expressionId(normalizeExpression(first.title ?? "").normalized)!;
    const result = qualifyOpportunity({ signals: [first, second], evidence: [directEvidenceFor(id)], previous: [], expressionId: id, competition: "mixed", delivery: "possible", commercialEvidence: true, audience: "creators", recommendedArtifact: "tool", coverage: { status: "available" } });
    expect(result.status).toBe("watch");
    expect(result.validation.missingChecks).toContain("demand evidence");
  });

  it("excludes failed raw signals from qualification projections and counts", () => {
    const valid = productHuntSignalFixture();
    const failed = { ...valid, id: "failed", sourceType: "github" as const, sourceName: "GitHub", sourceUrl: "https://github.com/failed", sourceFingerprint: "failed", evidenceStatus: "failed" as const };
    const id = expressionId(normalizeExpression(valid.title ?? "").normalized)!;
    const result = qualifyOpportunity({ signals: [valid, failed], evidence: [directEvidenceFor(id)], previous: [], expressionId: id, coverage: { status: "available" } });
    expect(result.validation.demand).toBe("single_signal");
    expect(result.status).toBe("watch");
  });

  it("counts demand only from candidateSignals for the selected expression", () => {
    const selected = productHuntSignalFixture();
    const otherExpression = { ...selected, id: "other-source", title: "Other Expression", externalId: "other-source", sourceType: "github" as const, sourceName: "GitHub", sourceUrl: "https://github.com/other" };
    const selectedId = expressionId(normalizeExpression(selected.title ?? "").normalized)!;
    const result = qualifyOpportunity({ signals: [selected, otherExpression], evidence: [directEvidenceFor(selectedId)], previous: [], expressionId: selectedId, coverage: { status: "available" } });
    expect(result.validation.demand).toBe("single_signal");
    expect(result.status).toBe("watch");
  });
});
