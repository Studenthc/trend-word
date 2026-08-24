import { appendFile, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendJsonl } from "../src/storage/jsonl.js";
import { RunStore } from "../src/storage/run-store.js";
import type { Opportunity, RawSignal } from "../src/types.js";

async function createTempRunStore(): Promise<RunStore> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "trend-word-storage-"));
  return new RunStore(workspaceRoot);
}

function signal(id: string): RawSignal {
  return {
    id,
    sourceType: "manual",
    sourceName: "test",
    sourceUrl: `https://example.com/${id}`,
    fetchedAt: "2026-08-24T00:00:00.000Z",
    sourceTier: "community",
    sourceFingerprint: `fingerprint-${id}`,
    evidenceStatus: "verified",
  };
}

function opportunity(id: string): Opportunity {
  return {
    id,
    primaryExpressionId: `expression-${id}`,
    title: `Opportunity ${id}`,
    summary: "A validated opportunity",
    audiences: ["builders"],
    userProblems: ["time"],
    recommendedArtifact: "tool",
    evidenceIds: [`evidence-${id}`],
    validation: {
      freshness: "confirmed",
      trend: "rising",
      intent: "tool",
      demand: "repeated",
      competition: "thin",
      monetization: "reported",
      delivery: "quick_mvp",
      confidence: "medium",
      missingChecks: [],
    },
    riskFlags: [],
    status: "new",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  };
}

describe("RunStore", () => {
  it("appends and reads raw signals without changing record order", async () => {
    const store = await createTempRunStore();

    await store.appendRawSignals([signal("a"), signal("b")]);

    expect((await store.readRawSignals()).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("reports malformed JSONL lines instead of treating them as empty data", async () => {
    const store = await createTempRunStore();
    await store.appendRawSignals([signal("keep")]);

    await expect(store.importJsonl("opportunities", "{bad-json}\n")).rejects.toThrow(/line 1/i);
  });

  it("stores run artifacts under the current date directory", async () => {
    const store = await createTempRunStore();

    await store.writeProjection("opportunities", [opportunity("today")]);

    const today = new Date().toISOString().slice(0, 10);
    expect(await store.readProjection("opportunities")).toEqual([opportunity("today")]);
    expect(store.runDirectory).toMatch(new RegExp(`[\\/]data[\\/]runs[\\/]${today}$`));
  });

  it("rejects malformed imported JSONL and preserves the previous projection", async () => {
    const store = await createTempRunStore();
    await store.writeProjection("opportunities", [opportunity("keep")]);

    await expect(store.importJsonl("opportunities", "{bad-json}\n")).rejects.toThrow();

    expect(await store.readProjection("opportunities")).toEqual([opportunity("keep")]);
  });

  it("imports valid opportunity JSONL and reads the validated projection", async () => {
    const store = await createTempRunStore();
    const record = opportunity("imported");

    await store.importJsonl("opportunities", `${JSON.stringify(record)}\n`);

    expect(await store.readProjection<Opportunity[]>("opportunities")).toEqual([record]);
  });

  it("rejects malformed projection records and preserves the previous projection", async () => {
    const store = await createTempRunStore();
    await store.writeProjection("opportunities", [opportunity("keep")]);

    await expect(store.writeProjection("opportunities", [{ id: "invalid" }])).rejects.toThrow();

    expect(await store.readProjection<Opportunity[]>("opportunities")).toEqual([opportunity("keep")]);
  });

  it("writes and reads validated opportunity history", async () => {
    const store = await createTempRunStore();
    const records = [opportunity("history")];

    await store.writeHistory(records);

    expect(await store.readHistory<Opportunity[]>()).toEqual(records);
  });

  it("rejects invalid dates before constructing run paths", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "trend-word-storage-"));

    expect(() => new RunStore(workspaceRoot, "../../outside")).toThrow();
    expect(() => new RunStore(workspaceRoot, "2026-8-24")).toThrow();
    expect(() => new RunStore(workspaceRoot, "2026-02-30")).toThrow();
  });

  it("rejects unserializable JSONL records before changing an existing file", async () => {
    const filePath = path.join(await mkdtemp(path.join(os.tmpdir(), "trend-word-jsonl-")), "signals.jsonl");
    await appendFile(filePath, '{"id":"keep"}\n', "utf8");

    await expect(appendJsonl(filePath, [{ id: "bad", value: BigInt(1) }])).rejects.toThrow();

    expect(await readFile(filePath, "utf8")).toBe('{"id":"keep"}\n');
  });
});
