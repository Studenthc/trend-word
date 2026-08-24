import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads safe defaults without requiring provider keys", async () => {
    const config = await loadConfig({ workspaceRoot: "/tmp/does-not-exist" });
    expect(config.sources.required).toEqual(["scys-mcp", "producthunt", "github"]);
    expect(config.sources.bestEffort).toEqual(["x-timeline", "reddit-feed"]);
    expect(config.googleTrends.mode).toBe("manual-or-optional");
  });

  it("rejects an unsupported source health status", async () => {
    await expect(loadConfig({
      workspaceRoot: "/tmp/does-not-exist",
      overrides: { sourceHealthStatus: "success" } as unknown,
    })).rejects.toThrow();
  });
});
