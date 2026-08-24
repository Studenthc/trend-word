import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { parseRawSignal, type SourceContext } from "../../src/types.js";
import { fixtureSourceAdapter } from "../../src/sources/fixtures.js";
import { dedupeRawSignals } from "../../src/domain/dedupe.js";

async function context(): Promise<SourceContext> {
  return {
    workspaceRoot: "/tmp/task-6-fixtures",
    fetchedAt: "2026-08-24T00:00:00.000Z",
    config: await loadConfig({ workspaceRoot: "/tmp/task-6-fixtures" }),
  };
}

describe("fixture source adapter", () => {
  it("returns deterministic validated signals for every planned source shape", async () => {
    const first = await fixtureSourceAdapter.collect(await context());
    const second = await fixtureSourceAdapter.collect(await context());
    expect(second).toEqual(first);
    expect(first.signals.map(parseRawSignal)).toHaveLength(7);
    expect(new Set(first.signals.map((item) => item.sourceType))).toEqual(new Set(["scys-mcp", "producthunt", "github", "x-timeline", "reddit-feed"]));
    expect(first.health.status).toBe("partial");
  });

  it("keeps duplicate reposts in raw input for domain dedupe", async () => {
    const result = await fixtureSourceAdapter.collect(await context());
    const duplicates = result.signals.filter((item) => item.sourceFingerprint === "fp-producthunt-repost");
    expect(duplicates).toHaveLength(2);
    expect(dedupeRawSignals(duplicates)).toHaveLength(2);
  });

  it("preserves a failed source record and its failure reason for audit", async () => {
    const result = await fixtureSourceAdapter.collect(await context());
    const failed = result.signals.find((item) => item.evidenceStatus === "failed");
    expect(failed?.failureReason).toMatch(/429|rate/i);
    expect(result.health.failureReasons.join(" ")).toMatch(/429|reddit/i);
  });
});
