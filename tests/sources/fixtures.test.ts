import { describe, expect, it } from "vitest";
import { parseRawSignal, type RawSignal } from "../../src/types.js";
import { fixtureCorpus, type MixedFixtureCorpus } from "../../src/sources/fixtures.js";
import type { SourceCollector } from "../../src/sources/source.js";
import { dedupeRawSignals, mergeExpressions } from "../../src/domain/dedupe.js";

describe("mixed fixture corpus", () => {
  it("returns deterministic validated signals for every planned source shape", async () => {
    const first = await fixtureCorpus.load();
    const second = await fixtureCorpus.load();
    expect(second).toEqual(first);
    expect(first.map(parseRawSignal)).toHaveLength(7);
    expect(new Set(first.map((item) => item.sourceType))).toEqual(new Set(["scys-mcp", "producthunt", "github", "x-timeline", "reddit-feed"]));
    expect(fixtureCorpus.kind).toBe("mixed-fixture-corpus");
  });

  it("keeps duplicate reposts in raw input for domain dedupe", async () => {
    const result = await fixtureCorpus.load();
    const duplicates = result.filter((item) => item.sourceFingerprint === "fp-producthunt-repost");
    expect(duplicates).toHaveLength(2);
    expect(dedupeRawSignals(duplicates)).toHaveLength(2);
    const expression = mergeExpressions(duplicates, [], { status: "available" })[0]!;
    expect(expression.independentAuthors).toBe(1);
    expect(expression.independentPublishers).toBe(1);
  });

  it("preserves a failed source record and its failure reason for audit", async () => {
    const result = await fixtureCorpus.load();
    const failed = result.find((item) => item.evidenceStatus === "failed");
    expect(failed?.failureReason).toMatch(/429|rate/i);
    expect(failed?.sourceType).toBe("reddit-feed");
  });

  it("is a loader for mixed raw signals, not a single-source collector", () => {
    const loader: () => Promise<RawSignal[]> = fixtureCorpus.load;
    const mixedCorpusIsNotCollector: MixedFixtureCorpus extends SourceCollector ? false : true = true;
    expect(loader).toBe(fixtureCorpus.load);
    expect(mixedCorpusIsNotCollector).toBe(true);
    expect(fixtureCorpus).not.toHaveProperty("collect");
  });
});
