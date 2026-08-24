import { describe, expect, it } from "vitest";
import type { Evidence, RawSignal } from "../src/types.js";
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
    const result = qualifyOpportunity({ signals: [productHuntSignalFixture()], evidence: [directEvidenceFor("productHuntSignalFixture")], previous: [] });
    expect(result.status).toBe("watch");
    expect(result.validation.demand).toBe("single_signal");
  });

  it("requires demand, supply, delivery, audience, and risk clearance before actionable", () => {
    const signal = productHuntSignalFixture();
    const signals = [signal, { ...signal, id: "github-1", sourceType: "github" as const, sourceName: "GitHub", sourceUrl: "https://github.com/example/repo", sourceFingerprint: "github-1", author: { name: "Developer" } }];
    const evidence = [
      directEvidenceFor(signal.id),
      { ...directEvidenceFor(signal.id), id: "competition", claimType: "serp_competition" as const, rawSignalId: "github-1" },
      { ...directEvidenceFor(signal.id), id: "delivery", claimType: "delivery" as const, rawSignalId: "github-1" },
      { ...directEvidenceFor(signal.id), id: "audience", claimType: "user_problem" as const, rawSignalId: "github-1" },
    ];
    const result = qualifyOpportunity({ signals, evidence, previous: [], audience: "AI creators", recommendedArtifact: "tool" });
    expect(result.status).toBe("actionable");
  });

  it("downgrades brand risk instead of treating it as actionable", () => {
    const result = qualifyOpportunity({ signals: [productHuntSignalFixture()], evidence: [directEvidenceFor("productHuntSignalFixture")], previous: [], riskFlags: ["brand"] });
    expect(result.status).toBe("rejected");
  });
});
