import type { Evidence, RawSignal } from "../types.js";

export type EvidenceValidationInput = { evidenceIds: string[]; evidence?: Evidence[]; rawSignals: RawSignal[] };
export type EvidenceValidationResult = { valid: boolean; evidence: Evidence[]; reason?: string };

export function validateEvidence(input: EvidenceValidationInput): EvidenceValidationResult {
  const evidence = input.evidence ?? [];
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const rawIds = new Set(input.rawSignals.map((item) => item.id));
  const selected: Evidence[] = [];
  for (const id of input.evidenceIds) {
    const item = byId.get(id);
    if (!item) return { valid: false, evidence: selected, reason: `missing raw signal for evidence ${id}` };
    if (!rawIds.has(item.rawSignalId)) return { valid: false, evidence: selected, reason: `missing raw signal ${item.rawSignalId}` };
    selected.push(item);
  }
  return { valid: true, evidence: selected };
}
