import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendCandidateFeedback, readCandidateFeedback } from "../src/storage/feedback-store.js";

describe("candidate feedback store", () => {
  it("appends and reads keep/skip feedback without losing prior decisions", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-feedback-test-"));
    await appendCandidateFeedback(workspaceRoot, { candidateId: "candidate-ai", decision: "keep", recordedAt: "2026-08-25T01:00:00.000Z" });
    await appendCandidateFeedback(workspaceRoot, { candidateId: "candidate-ai", decision: "skip", reason: "竞争太强", recordedAt: "2026-08-25T02:00:00.000Z" });
    await expect(readCandidateFeedback(workspaceRoot)).resolves.toEqual([
      { candidateId: "candidate-ai", decision: "keep", recordedAt: "2026-08-25T01:00:00.000Z" },
      { candidateId: "candidate-ai", decision: "skip", reason: "竞争太强", recordedAt: "2026-08-25T02:00:00.000Z" },
    ]);
  });
});
