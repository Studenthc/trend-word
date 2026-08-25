import { describe, expect, it } from "vitest";
import { buildCandidateQueue } from "../src/domain/candidates.js";
import type { RawSignal } from "../src/types.js";

function signal(id: string, changes: Partial<RawSignal> = {}): RawSignal {
  return {
    id,
    sourceType: "scys-mcp",
    sourceName: "生财风向标",
    sourceUrl: `https://scys.com/topic/${id}`,
    externalId: id,
    title: "AI 新需求标题",
    body: "正文里有人明确提到“AI短剧带货”，并描述了具体使用场景。",
    author: { name: "作者" },
    publishedAt: "2026-08-24T00:00:00.000Z",
    fetchedAt: "2026-08-25T00:00:00.000Z",
    sourceTier: "community",
    sourceFingerprint: id,
    evidenceStatus: "verified",
    ...changes,
  };
}

describe("candidate queue", () => {
  it("extracts a concrete quoted term from body context and builds a 7-day Trends link", () => {
    const result = buildCandidateQueue([signal("one")], { now: "2026-08-25T00:00:00.000Z" });
    expect(result.formal).toHaveLength(1);
    expect(result.formal[0]).toMatchObject({
      term: "AI短剧带货",
      lane: "formal",
      context: expect.stringContaining("AI短剧带货"),
      trendsUrl: "https://trends.google.com/trends/explore?date=now%207-d&geo=CN&q=AI%E7%9F%AD%E5%89%A7%E5%B8%A6%E8%B4%A7",
    });
  });

  it("keeps title-only signals out of formal candidates", () => {
    const result = buildCandidateQueue([signal("title-only", { body: "AI 新需求标题", excerpt: undefined })]);
    expect(result.formal).toEqual([]);
    expect(result.backup[0]).toMatchObject({ lane: "backup", missingFields: ["正文上下文"] });
  });

  it("uses a specific title as the term when distinct body context supports it", () => {
    const result = buildCandidateQueue([signal("title-context", { title: "AI 工作流风向标", body: "正文说明了团队如何反复使用这个工作流，并遇到交付问题。" })]);
    expect(result.formal[0]).toMatchObject({ term: "AI 工作流", lane: "formal" });
  });

  it("limits formal candidates to ten and lets skip feedback lower a candidate", () => {
    const signals = Array.from({ length: 11 }, (_, index) => signal(String(index), { body: `正文“新词${index}”需求场景` }));
    const result = buildCandidateQueue(signals, {
      feedback: [{ candidateId: "candidate-新词10", decision: "skip", recordedAt: "2026-08-25T01:00:00.000Z" }],
    });
    expect(result.formal).toHaveLength(10);
    expect(result.formal.some((item) => item.term === "新词10")).toBe(false);
  });
});
