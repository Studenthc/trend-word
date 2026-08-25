import { describe, expect, it } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runRadar } from "../src/index.js";

describe("runRadar", () => {
  it("returns a run summary and report projection for fixture input", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "seed-radar-"));
    const result = await runRadar({ date: "2026-08-24", sourceNames: ["fixtures"], workspaceRoot });
    expect(result.summary.date).toBe("2026-08-24");
    expect(result.summary.sourcesAttempted).toContain("fixtures");
    expect(result.report).toContain("新词机会雷达");
    expect(await readdir(path.join(workspaceRoot, "data", "runs", "2026-08-24"))).toEqual(expect.arrayContaining(["seed-terms.json", "expression-clusters.json", "candidates.json"]));
  });
});
