import { describe, expect, it } from "vitest";
import type { Evidence, RawSignal } from "../src/types.js";
import { validateEvidence } from "../src/domain/evidence.js";

const rawSignal: RawSignal = {
  id: "raw-1", sourceType: "manual", sourceName: "Research", sourceUrl: "https://example.com/source",
  title: "AI 工作流", fetchedAt: "2026-08-24T00:00:00.000Z", sourceTier: "community",
  sourceFingerprint: "raw-1-fingerprint", evidenceStatus: "verified",
};
const evidence: Evidence = {
  id: "evidence-1", subjectId: "expression-1", claimType: "user_problem", rawSignalId: "raw-1",
  quote: "用户正在寻找 AI 工作流", location: "body", capturedAt: "2026-08-24T00:00:00.000Z",
  evidenceGrade: "direct", independentFrom: ["publisher-1"],
};

describe("validateEvidence", () => {
  it("preserves the auditable evidence fields when the raw signal exists", () => {
    const result = validateEvidence({ evidenceIds: ["evidence-1"], evidence: [evidence], rawSignals: [rawSignal] });
    expect(result).toMatchObject({ valid: true, evidence: [evidence] });
  });

  it("downgrades a candidate when its cited raw signal is missing", () => {
    const result = validateEvidence({ evidenceIds: ["missing"], rawSignals: [] });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("missing raw signal");
  });

  it("rejects evidence attached to another subject", () => {
    const result = validateEvidence({
      evidenceIds: ["evidence-1"], evidence: [evidence], rawSignals: [rawSignal], expectedSubjectId: "expression-2",
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("subject");
  });

  it("rejects evidence whose cited raw signal failed collection", () => {
    const result = validateEvidence({
      evidenceIds: ["evidence-1"], evidence: [evidence], rawSignals: [{ ...rawSignal, evidenceStatus: "failed" }],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("failed raw signal");
  });
});
