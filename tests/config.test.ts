import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { parseRawSignal, parseSourceHealth } from "../src/types.js";

describe("loadConfig", () => {
  it("loads safe defaults without requiring provider keys", async () => {
    const config = await loadConfig({ workspaceRoot: "/tmp/does-not-exist" });
    expect(config).toEqual({
      sources: {
        required: ["scys-mcp", "producthunt", "github"],
        bestEffort: ["x-timeline", "reddit-feed"],
        manual: true,
      },
      scys: { enabled: true, queries: ["AI", "出海", "风向标"] },
      producthunt: { enabled: true, limit: 50 },
      github: { enabled: true, queries: ["ai tool", "mcp", "agent"], limit: 30 },
      xTimeline: { enabled: false, handles: [] },
      redditFeed: { enabled: false, communities: [] },
      googleTrends: { mode: "manual-or-optional", region: "US" },
      report: { maxActionable: 5, maxWatch: 20 },
    });
  });

  it("rejects an unsupported source health status", async () => {
    await expect(loadConfig({
      workspaceRoot: "/tmp/does-not-exist",
      overrides: { sourceHealthStatus: "success" } as unknown,
    })).rejects.toThrow();
  });

  it("loads a fixture config and applies nested overrides without returning secret fields", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-config-"));
    try {
      await writeFile(path.join(workspaceRoot, "radar.config.json"), JSON.stringify({
        github: { enabled: false, limit: 7, apiKey: "file-secret" },
        scys: { apiKey: "nested-file-secret" },
        report: { maxWatch: 9 },
        apiKey: "top-level-secret",
      }));

      const config = await loadConfig({
        workspaceRoot,
        overrides: { github: { limit: 11 }, report: { maxActionable: 2 } },
      });

      expect(config.github).toEqual({ enabled: false, queries: ["ai tool", "mcp", "agent"], limit: 11 });
      expect(config.report).toEqual({ maxActionable: 2, maxWatch: 9 });
      expect(config).not.toHaveProperty("apiKey");
      expect(config.scys).not.toHaveProperty("apiKey");
      expect(config.github).not.toHaveProperty("apiKey");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("parses persisted raw signals and source health records at runtime", () => {
    const rawSignal = parseRawSignal({
      id: "signal-1",
      sourceType: "github",
      sourceName: "GitHub",
      sourceUrl: "https://github.com/example/project",
      fetchedAt: "2026-08-24T00:00:00.000Z",
      sourceTier: "market",
      sourceFingerprint: "fingerprint-1",
      evidenceStatus: "verified",
      unexpectedSecret: "not-persisted",
    });
    const sourceHealth = parseSourceHealth({
      sourceType: "github",
      status: "available",
      attemptedAt: "2026-08-24T00:00:00.000Z",
      itemCount: 1,
      failureReasons: [],
      coverageNotes: [],
      token: "not-persisted",
    });

    expect(rawSignal).not.toHaveProperty("unexpectedSecret");
    expect(sourceHealth).not.toHaveProperty("token");
  });
});
