import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RunStore } from "../src/storage/run-store.js";
import type { RawSignal } from "../src/types.js";

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

    await store.writeProjection("opportunities", [{ id: "today" }]);

    const today = new Date().toISOString().slice(0, 10);
    expect(await store.readProjection("opportunities")).toEqual([{ id: "today" }]);
    expect(store.runDirectory).toMatch(new RegExp(`[\\/]data[\\/]runs[\\/]${today}$`));
  });

  it("rejects malformed imported JSONL and preserves the previous projection", async () => {
    const store = await createTempRunStore();
    await store.writeProjection("opportunities", [{ id: "keep" }]);

    await expect(store.importJsonl("opportunities", "{bad-json}\n")).rejects.toThrow();

    expect(await store.readProjection("opportunities")).toEqual([{ id: "keep" }]);
  });
});
