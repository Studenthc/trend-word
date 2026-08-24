import { describe, expect, it } from "vitest";
import type { RawSignal } from "../src/types.js";
import { dedupeRawSignals, mergeExpressions } from "../src/domain/dedupe.js";
import { expressionId } from "../src/domain/normalize.js";

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
    expect(dedupeRawSignals(signals)).toHaveLength(3);
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

  it("uses canonical ids and propagates failed coverage to lifecycle", () => {
    const previous = mergeExpressions([signal("old-1"), signal("old-2", { sourceUrl: "https://example.com/old-2" })], [])[0]!;
    const prior = { ...previous, id: "legacy-id", lifecycle: "stable" as const, lastSeenAt: "2026-08-24T00:00:00.000Z" };
    const current = mergeExpressions([signal("new-1", { fetchedAt: "2026-08-25T00:00:00.000Z" })], [prior], { status: "failed" })[0]!;
    expect(current.id).toBe(expressionId("ai 工作流"));
    expect(current.lifecycle).toBe("stable");
  });

  it("canonicalizes valid signal timestamps and ignores unusable text", () => {
    const current = mergeExpressions([
      signal("offset", { title: "  ", excerpt: "  AI 工作流  ", publishedAt: "2026-08-24T08:00:00+08:00", fetchedAt: "2026-08-24T00:00:00Z" }),
      signal("blank", { title: " ", excerpt: "", body: "\t", sourceUrl: "https://example.com/blank" }),
    ], []);
    expect(current).toHaveLength(1);
    expect(current[0]!.firstSeenAt).toBe("2026-08-24T00:00:00.000Z");
    expect(current[0]!.lastSeenAt).toBe("2026-08-24T00:00:00.000Z");
    expect(current[0]!.occurrences[0]!.seenAt).toBe("2026-08-24T00:00:00.000Z");
  });

  it("excludes failed raw signals from expression projection", () => {
    expect(mergeExpressions([signal("failed", { evidenceStatus: "failed" })], [])).toEqual([]);
  });

  it("deduplicates stable author ids when names vary across independent records", () => {
    const current = mergeExpressions([
      signal("a", { author: { id: "author-1", name: "Alice" }, sourceFingerprint: "one" }),
      signal("b", { author: { id: "author-1", name: "Alice Chen" }, sourceFingerprint: "two", sourceUrl: "https://example.com/b" }),
    ], [])[0]!;
    expect(current.independentAuthors).toBe(1);
  });

  it("names independent publishers by source type and normalizes communities", () => {
    const current = mergeExpressions([
      signal("ph", { sourceType: "producthunt", sourceName: "Display A", community: " AI  Creators ", sourceFingerprint: "ph" }),
      signal("gh", { sourceType: "github", sourceName: "Display B", community: "ai creators", sourceFingerprint: "gh", sourceUrl: "https://github.com/gh" }),
    ], [])[0]!;
    expect(current.independentPublishers).toBe(2);
    expect(current.independentCommunities).toBe(1);
    expect(current.sourceFamilies).toEqual(["producthunt", "github"]);
  });
});
