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
  it("collapses only raw identities scoped to the same source", () => {
    const result = dedupeRawSignals([
      signal("one"),
      signal("two", { id: "two", sourceUrl: "https://producthunt.com/posts/one" }),
      signal("three", { externalId: "same", title: "Second" }),
      signal("four", { externalId: "same", title: "Other" }),
      signal("five", { sourceType: "github", sourceName: "GitHub", sourceUrl: "https://github.com/five", title: "ai 工作流！" }),
    ]);
    expect(result.map((item) => item.id)).toEqual(["one", "three", "five"]);
  });

  it("keeps raw records and excludes reposts from independent projections", () => {
    const signals = [
      signal("one", { author: { name: "A" }, community: "AI", sourceFingerprint: "same-content" }),
      signal("two", { author: { name: "B" }, community: "Creators", sourceFingerprint: "same-content", sourceUrl: "https://example.com/two" }),
      signal("three", { sourceName: "GitHub", sourceType: "github", sourceFingerprint: "same-content", sourceUrl: "https://github.com/x", author: { name: "C" }, community: "Developers" }),
    ];
    expect(signals[0]!.author?.name).toBe("A");
    const expressions = mergeExpressions(signals, []);
    const expression = expressions[0]!;
    expect(expression.independentAuthors).toBe(1);
    expect(expression.independentPublishers).toBe(1);
    expect(expression.independentCommunities).toBe(1);
    expect(expression.sourceFamilies).toEqual(["producthunt"]);
    expect(expression.occurrences).toHaveLength(3);

    const crossSource = mergeExpressions([
      signals[0]!,
      { ...signals[0]!, id: "independent-github", sourceType: "github", sourceName: "GitHub", sourceFingerprint: "different-content", sourceUrl: "https://github.com/independent" },
    ], [])[0]!;
    expect(crossSource.sourceFamilies).toEqual(["producthunt", "github"]);
    expect(crossSource.independentPublishers).toBe(2);
  });

  it("keeps the same expression from different source types and unusable signals distinct", () => {
    const result = dedupeRawSignals([
      signal("manual-1", { sourceType: "manual", sourceName: "Manual", sourceUrl: "https://example.com/manual", title: "" }),
      signal("manual-2", { sourceType: "manual", sourceName: "Manual", sourceUrl: "https://example.com/manual-2", title: " " }),
      signal("github-1", { sourceType: "github", sourceName: "GitHub", sourceUrl: "https://github.com/one" }),
    ]);
    expect(result.map((item) => item.id)).toEqual(["manual-1", "manual-2", "github-1"]);
  });

  it("does not use another source's URL or external id as a raw duplicate", () => {
    const result = dedupeRawSignals([
      signal("product", { sourceUrl: "https://shared.example/item", externalId: "shared" }),
      signal("github", { sourceType: "github", sourceName: "GitHub", sourceUrl: "https://shared.example/item", externalId: "shared" }),
    ]);
    expect(result.map((item) => item.id)).toEqual(["product", "github"]);
  });
});
