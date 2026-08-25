import path from "node:path";
import type { CandidateFeedback } from "../domain/candidates.js";
import { appendJsonl, readJsonl } from "./jsonl.js";

export async function appendCandidateFeedback(workspaceRoot: string, feedback: CandidateFeedback): Promise<void> {
  await appendJsonl(feedbackPath(workspaceRoot), [parseFeedback(feedback)]);
}

export async function readCandidateFeedback(workspaceRoot: string): Promise<CandidateFeedback[]> {
  return readJsonl(feedbackPath(workspaceRoot), parseFeedback);
}

function feedbackPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, "data", "feedback", "candidate-feedback.jsonl");
}

function parseFeedback(value: unknown): CandidateFeedback {
  if (typeof value !== "object" || value === null) throw new Error("feedback must be an object");
  const record = value as Record<string, unknown>;
  if (typeof record.candidateId !== "string" || !record.candidateId.trim()) throw new Error("feedback candidateId is required");
  if (record.decision !== "keep" && record.decision !== "skip" && record.decision !== "false_positive") throw new Error("feedback decision is invalid");
  if (typeof record.recordedAt !== "string" || !record.recordedAt.trim()) throw new Error("feedback recordedAt is required");
  return {
    candidateId: record.candidateId.trim(),
    decision: record.decision,
    ...(typeof record.reason === "string" && record.reason.trim() ? { reason: record.reason.trim() } : {}),
    recordedAt: record.recordedAt,
  };
}
