import { describe, expect, it } from "vitest";
import type { RawSignal } from "../src/types.js";
import { dedupeRawSignals, mergeExpressions } from "../src/domain/dedupe.js";

function signal(id: string, changes: Partial<RawSignal> = {}): RawSignal {
  return {
    id,
    sourceType: "producthunt",
    sourceName: "Product Hunt",
    sourceUrl: `https://producthunt.com/posts/${id}`,
    title: "AI 工作流",
    fetchedAt: "2026-08-24T00:00:00.000Z",
    sourceTier: "market",
    sourceFingerprint: `fingerprint-${id}`,
    evidenceStatus: "verified",
    ...changes,
  };
}

describe("dedupeRawSignals", () => {
  it("collapses matching URL, external ID, and normalized expression projections", () => {
    const result = dedupeRawSignals([
      signal("one"),
      signal("two", { id: "two", sourceUrl: "https://producthunt.com/posts/one" }),
      signal("three", { externalId: "same", title: "Second" }),
      signal("four", { externalId: "same", title: "Other" }),
      signal("five", { sourceUrl: "https://example.com/five", title: "ai 工作流！" }),
    ]);
    expect(result.map((item) => item.id)).toEqual(["one", "three"]);
  });

  it("keeps raw records intact while projections count publishers, not authors or reposts", () => {
    const signals = [
      signal("one", { author: { name: "A" }, sourceFingerprint: "same-content" }),
      signal("two", { author: { name: "B" }, sourceFingerprint: "same-content", sourceUrl: "https://example.com/two" }),
      signal("three", { sourceName: "GitHub", sourceType: "github", sourceFingerprint: "github-content", sourceUrl: "https://github.com/x" }),
    ];
    expect(signals[0]!.author?.name).toBe("A");
    const expressions = mergeExpressions(signals, []);
    const expression = expressions[0]!;
    expect(expression.independentAuthors).toBe(2);
    expect(expression.independentPublishers).toBe(2);
    expect(expression.occurrences).toHaveLength(3);
  });
});
