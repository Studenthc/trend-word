import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { parseRawSignal, type SourceContext } from "../../src/types.js";
import { fixtureCorpus } from "../../src/sources/fixtures.js";
import { dedupeRawSignals, mergeExpressions } from "../../src/domain/dedupe.js";

async function context(): Promise<SourceContext> {
  return {
    workspaceRoot: "/tmp/task-6-fixtures",
    fetchedAt: "2026-08-24T00:00:00.000Z",
    config: await loadConfig({ workspaceRoot: "/tmp/task-6-fixtures" }),
  };
}

describe("mixed fixture corpus", () => {
  it("returns deterministic validated signals for every planned source shape", async () => {
    const first = await fixtureCorpus.collect(await context());
    const second = await fixtureCorpus.collect(await context());
    expect(second).toEqual(first);
    expect(first.signals.map(parseRawSignal)).toHaveLength(7);
    expect(new Set(first.signals.map((item) => item.sourceType))).toEqual(new Set(["scys-mcp", "producthunt", "github", "x-timeline", "reddit-feed"]));
    expect(first.health.status).toBe("partial");
    expect(fixtureCorpus.kind).toBe("mixed-fixture-corpus");
  });

  it("keeps duplicate reposts in raw input for domain dedupe", async () => {
    const result = await fixtureCorpus.collect(await context());
    const duplicates = result.signals.filter((item) => item.sourceFingerprint === "fp-producthunt-repost");
    expect(duplicates).toHaveLength(2);
    expect(dedupeRawSignals(duplicates)).toHaveLength(2);
    const expression = mergeExpressions(duplicates, [], { status: "available" })[0]!;
    expect(expression.independentAuthors).toBe(1);
    expect(expression.independentPublishers).toBe(1);
  });

  it("preserves a failed source record and its failure reason for audit", async () => {
    const result = await fixtureCorpus.collect(await context());
    const failed = result.signals.find((item) => item.evidenceStatus === "failed");
    expect(failed?.failureReason).toMatch(/429|rate/i);
    expect(result.health.failureReasons.join(" ")).toMatch(/429|reddit/i);
  });
});
