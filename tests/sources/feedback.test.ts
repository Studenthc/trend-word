import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseRawSignal, parseSourceHealth } from "../../src/types.js";
import { enrichSignalsWithFeedback, fetchEntityFeedback, type FeedbackTransport } from "../../src/sources/feedback.js";
import type { RawSignal } from "../../src/types.js";

const feedbackSignal = {
  id: "github-issue-acme-flowpilot-12",
  sourceType: "github" as const,
  sourceName: "GitHub Issues",
  sourceUrl: "https://github.com/acme/flowpilot/issues/12",
  externalId: "acme/flowpilot#12",
  title: "Looking for a Zapier alternative",
  body: "We need a self-hosted replacement for Zapier.",
  parentSignalId: "github-acme/flowpilot",
  signalKind: "feedback" as const,
  tags: ["feedback", "github-issue"],
  fetchedAt: "2026-09-01T00:00:00.000Z",
  sourceTier: "community" as const,
  sourceFingerprint: "github:issue:acme/flowpilot#12",
  evidenceStatus: "verified" as const,
};

function entity(sourceType: "github" | "producthunt", changes: Partial<RawSignal> = {}): RawSignal {
  return {
    id: `${sourceType}-acme-flowpilot`,
    sourceType,
    sourceName: sourceType === "github" ? "GitHub" : "Product Hunt",
    sourceUrl: sourceType === "github" ? "https://github.com/acme/flowpilot" : "https://www.producthunt.com/posts/flowpilot",
    externalId: sourceType === "github" ? "acme/flowpilot" : "ph-1",
    title: "FlowPilot",
    body: "Workflow automation",
    fetchedAt: "2026-09-01T00:00:00.000Z",
    sourceTier: sourceType === "github" ? "first_party" : "market",
    sourceFingerprint: `${sourceType}:acme:flowpilot`,
    evidenceStatus: "verified",
    ...changes,
  };
}

function response(body: unknown, status = 200): Awaited<ReturnType<FeedbackTransport>> {
  return { status, headers: new Headers({ "content-type": "application/json" }), text: async () => JSON.stringify(body) };
}

describe("feedback contracts", () => {
  it("preserves parent entity and feedback kind on a raw signal", () => {
    const parsed = parseRawSignal(feedbackSignal);
    expect(parsed).toMatchObject({ signalKind: "feedback", parentSignalId: "github-acme/flowpilot", tags: ["feedback", "github-issue"] });
  });

  it("keeps existing entity signals valid without feedback metadata", () => {
    const parsed = parseRawSignal({ ...feedbackSignal, id: "github-acme-flowpilot", title: "acme/flowpilot", body: "Workflow automation", sourceName: "GitHub", sourceTier: "first_party", sourceFingerprint: "github:acme/flowpilot", parentSignalId: undefined, signalKind: undefined, tags: undefined });
    expect(parsed.signalKind).toBeUndefined();
    expect(parsed.parentSignalId).toBeUndefined();
  });

  it("accepts feedback coverage counters without changing source health semantics", () => {
    const source = parseSourceHealth({ sourceType: "github", status: "available", attemptedAt: "2026-09-01T00:00:00.000Z", itemCount: 20, failureReasons: [], coverageNotes: [] });
    expect(source.status).toBe("available");
  });

  it("turns recent GitHub issues into feedback signals and skips pull requests", async () => {
    const result = await fetchEntityFeedback(entity("github"), async (request) => {
      expect(request.url).toContain("/repos/acme/flowpilot/issues?");
      return response([
        { number: 12, title: "Looking for a Zapier alternative", body: "We need a self-hosted replacement.", html_url: "https://github.com/acme/flowpilot/issues/12", user: { id: 7, login: "user-a" }, created_at: "2026-09-01T00:00:00.000Z" },
        { number: 13, title: "Pull request", body: "not feedback", pull_request: {}, html_url: "https://github.com/acme/flowpilot/pull/13" },
      ]);
    }, "2026-09-01T01:00:00.000Z");
    expect(result).toMatchObject({ status: "success" });
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({ signalKind: "feedback", parentSignalId: "github-acme-flowpilot", tags: ["feedback", "github-issue"], title: "Looking for a Zapier alternative", sourceTier: "community" });
  });

  it("parses Product Hunt comments and keeps the parent launch relation", async () => {
    const result = await fetchEntityFeedback(entity("producthunt"), async (request) => {
      expect(request.method).toBe("POST");
      expect(request.body).toContain("comments");
      return response({ data: { post: { comments: { edges: [{ node: { id: "comment-1", body: "I need a way to export the generated reports.", createdAt: "2026-09-01T00:00:00.000Z", user: { id: "user-1", name: "User" } } }] } } } });
    }, "2026-09-01T01:00:00.000Z");
    expect(result).toMatchObject({ status: "success" });
    expect(result.signals[0]).toMatchObject({ signalKind: "feedback", parentSignalId: "producthunt-acme-flowpilot", sourceName: "Product Hunt comments", body: expect.stringContaining("export"), tags: ["feedback", "producthunt-comment"] });
  });

  it.each([401, 403, 429])("marks GitHub HTTP %s as unavailable", async (status) => {
    const result = await fetchEntityFeedback(entity("github"), async () => response({}, status), "2026-09-01T01:00:00.000Z");
    expect(result).toMatchObject({ status: "unavailable", signals: [] });
  });

  it("marks missing Product Hunt comments as unavailable instead of zero demand", async () => {
    const result = await fetchEntityFeedback(entity("producthunt"), async () => response({ data: { post: { comments: { edges: [] } } } }), "2026-09-01T01:00:00.000Z");
    expect(result).toMatchObject({ status: "empty", signals: [] });
  });

  it("caches successful feedback enrichment per entity", async () => {
    let calls = 0;
    const transport: FeedbackTransport = async () => { calls += 1; return response([]); };
    const root = await mkdtemp(path.join(os.tmpdir(), "trend-word-feedback-cache-test-"));
    await enrichSignalsWithFeedback([entity("github")], { github: transport }, root, "2026-09-01T01:00:00.000Z", 1);
    await enrichSignalsWithFeedback([entity("github")], { github: transport }, root, "2026-09-01T01:00:00.000Z", 1);
    expect(calls).toBe(1);
  });

  it("refreshes feedback cache on a later run date", async () => {
    let calls = 0;
    const transport: FeedbackTransport = async () => { calls += 1; return response([]); };
    const root = await mkdtemp(path.join(os.tmpdir(), "trend-word-feedback-cache-refresh-test-"));
    await enrichSignalsWithFeedback([entity("github")], { github: transport }, root, "2026-09-01T01:00:00.000Z", 1);
    await enrichSignalsWithFeedback([entity("github")], { github: transport }, root, "2026-09-02T01:00:00.000Z", 1);
    expect(calls).toBe(2);
  });
});
