import { describe, expect, it } from "vitest";
import { runRadar } from "../src/index.js";

describe("runRadar", () => {
  it("returns a run summary and report projection for fixture input", async () => {
    const result = await runRadar({ date: "2026-08-24", sourceNames: ["fixtures"] });
    expect(result.summary.date).toBe("2026-08-24");
    expect(result.summary.sourcesAttempted).toContain("fixtures");
    expect(result.report).toContain("新词机会雷达");
  });
});
