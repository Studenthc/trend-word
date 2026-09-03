import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { parseRawSignal, parseSourceHealth, type SourceAdapter } from "../src/types.js";

async function withTempWorkspace<T>(callback: (workspaceRoot: string) => Promise<T>): Promise<T> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "radar-config-"));
  try {
    return await callback(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

describe("loadConfig", () => {
  it("loads safe defaults without requiring provider keys", async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const config = await loadConfig({ workspaceRoot });
      expect(config).toEqual({
        sources: {
          required: ["producthunt", "github"],
          bestEffort: ["x-timeline", "reddit-feed", "model-catalog"],
          validation: ["scys-mcp"],
          manual: true,
        },
        scys: { enabled: true, queries: ["AI", "带货", "视频号"] },
        discovery: { recentDays: 7, maxSourcesPerQuery: 3 },
        producthunt: { enabled: true, limit: 50 },
        github: { enabled: true, queries: ["ai tool", "mcp", "agent"], limit: 30 },
        modelCatalog: { enabled: true, platforms: ["huggingface", "fal-ai"], recentDays: 7, limitPerPlatform: 20 },
        xTimeline: { enabled: true, handles: ["OpenAI", "AnthropicAI", "karpathy", "sama", "levelsio"] },
        redditFeed: { enabled: true, communities: ["Entrepreneur", "SaaS", "artificial"] },
        googleTrends: { mode: "manual-or-optional", region: "US" },
        report: { maxActionable: 5, maxWatch: 20, maxVerificationItems: 10 },
      });
    });
  });

  it("accepts manual Google Trends verification records", async () => {
    const { parseTrendVerification } = await import("../src/types.js");
    expect(parseTrendVerification({
      candidateId: "candidate-demo",
      provider: "google_trends_manual",
      checkedAt: "2026-08-26T10:00:00.000Z",
      window: "7d",
      region: "CN",
      result: "rising",
      relatedQueries: [{ text: "demo tool", type: "rising", growth: 100 }],
    })).toMatchObject({ candidateId: "candidate-demo", result: "rising" });
  });

  it("rejects unknown fields at the config boundary", async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await expect(loadConfig({
        workspaceRoot,
        overrides: { sourceHealthStatus: "success" } as unknown,
      })).rejects.toThrow();
      await expect(loadConfig({
        workspaceRoot,
        overrides: { github: { apiKey: "not-config" } } as unknown,
      })).rejects.toThrow();
    });
  });

  it("rejects an unsupported source health status", () => {
    expect(() => parseSourceHealth({
      sourceType: "github",
      status: "success",
      attemptedAt: "2026-08-24T00:00:00.000Z",
      itemCount: 0,
      failureReasons: [],
      coverageNotes: [],
    })).toThrow();
  });

  it("loads a fixture config and applies nested overrides", async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await writeFile(path.join(workspaceRoot, "radar.config.json"), JSON.stringify({
        github: { enabled: false, limit: 7 },
        report: { maxWatch: 9 },
      }));

      const config = await loadConfig({
        workspaceRoot,
        overrides: { github: { limit: 11 }, report: { maxActionable: 2 } },
      });

      expect(config.github).toEqual({ enabled: false, queries: ["ai tool", "mcp", "agent"], limit: 11 });
      expect(config.report).toEqual({ maxActionable: 2, maxWatch: 9, maxVerificationItems: 10 });
    });
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

  it("exposes the canonical source adapter contract", async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const adapter: SourceAdapter = {
        name: "fixtures",
        collect: async (context) => ({
          signals: [],
          health: parseSourceHealth({
            sourceType: "producthunt",
            status: "empty",
            attemptedAt: context.fetchedAt,
            itemCount: 0,
            failureReasons: [],
            coverageNotes: [],
          }),
        }),
      };
      const collection = await adapter.collect({
        workspaceRoot,
        fetchedAt: "2026-08-24T00:00:00.000Z",
        config: await loadConfig({ workspaceRoot }),
      });

      expect(collection).toEqual({
        signals: [],
        health: expect.objectContaining({ sourceType: "producthunt", status: "empty" }),
      });
    });
  });
});
