import type { Evidence, RawSignal } from "../types.js";

export type EvidenceValidationInput = { evidenceIds: string[]; evidence?: Evidence[]; rawSignals: RawSignal[]; expectedSubjectId?: string; expectedRawSignalIds?: string[] };
export type EvidenceValidationResult = { valid: boolean; evidence: Evidence[]; reason?: string };

export function validateEvidence(input: EvidenceValidationInput): EvidenceValidationResult {
  const evidence = input.evidence ?? [];
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const rawIds = new Set(input.rawSignals.map((item) => item.id));
  const expectedRawIds = input.expectedRawSignalIds ? new Set(input.expectedRawSignalIds) : undefined;
  const selected: Evidence[] = [];
  let reason: string | undefined;
  for (const id of input.evidenceIds) {
    const item = byId.get(id);
    if (!item) {
      reason ??= `missing raw signal for evidence ${id}`;
      continue;
    }
    if (!rawIds.has(item.rawSignalId)) {
      reason ??= `missing raw signal ${item.rawSignalId}`;
      continue;
    }
    if (expectedRawIds && !expectedRawIds.has(item.rawSignalId)) {
      reason ??= `evidence ${id} cites a different candidate raw signal`;
      continue;
    }
    const rawSignal = input.rawSignals.find((signal) => signal.id === item.rawSignalId);
    if (rawSignal?.evidenceStatus === "failed") {
      reason ??= `failed raw signal ${item.rawSignalId}`;
      continue;
    }
    if (input.expectedSubjectId !== undefined && item.subjectId !== input.expectedSubjectId) {
      reason ??= `evidence ${id} has unexpected subject`;
      continue;
    }
    selected.push(item);
  }
  return reason ? { valid: false, evidence: selected, reason } : { valid: true, evidence: selected };
}
