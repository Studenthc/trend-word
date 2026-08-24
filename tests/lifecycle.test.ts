import { describe, expect, it } from "vitest";
import type { Expression } from "../src/types.js";
import { deriveLifecycle } from "../src/domain/lifecycle.js";

function expression(id: string, count: number, lifecycle: Expression["lifecycle"] = "new"): Expression {
  return {
    id, text: "AI 工作流", normalizedText: "ai 工作流", aliases: [], kind: "concept",
    firstSeenAt: "2026-08-20", lastSeenAt: "2026-08-24",
    occurrences: Array.from({ length: count }, (_, index) => ({ rawSignalId: `${id}-${index}`, sourceType: "manual", seenAt: "2026-08-24" })),
    sourceFamilies: ["manual"], independentAuthors: count, independentCommunities: 0, independentPublishers: count,
    lifecycle, trendState: "unknown", qualification: "discovered", rejectionReasons: [],
  };
}

describe("deriveLifecycle", () => {
  it("derives new, watch, rising, stable, and fading transitions", () => {
    expect(deriveLifecycle(expression("new", 1))).toBe("new");
    expect(deriveLifecycle(expression("watch", 1), expression("watch", 1, "new"))).toBe("watch");
    expect(deriveLifecycle(expression("rise", 3), expression("rise", 1, "watch"))).toBe("rising");
    expect(deriveLifecycle(expression("stable", 2), expression("stable", 2, "stable"))).toBe("stable");
    expect(deriveLifecycle({ ...expression("fade", 0), lastSeenAt: "2026-08-25" }, expression("fade", 2, "stable"))).toBe("fading");
  });

  it("retains state for failed and insufficient partial coverage", () => {
    const previous = expression("failed", 2, "stable");
    const current = { ...previous, occurrences: [], lastSeenAt: "2026-08-25T00:00:00.000Z" };
    expect(deriveLifecycle(current, previous, { status: "failed" })).toBe("stable");
    expect(deriveLifecycle(current, previous, { status: "partial", coverageAvailable: false })).toBe("stable");
  });

  it("compares instants canonically and ignores invalid dates for trend changes", () => {
    const previous = { ...expression("dates", 2, "stable"), lastSeenAt: "2026-08-24T00:00:00.000Z" };
    const sameInstant = { ...previous, occurrences: [], lastSeenAt: "2026-08-24T08:00:00.000+08:00" };
    expect(deriveLifecycle(sameInstant, previous, { status: "available" })).toBe("stable");
    expect(deriveLifecycle({ ...sameInstant, lastSeenAt: "not-a-date" }, previous, { status: "available" })).toBe("stable");
  });
});
