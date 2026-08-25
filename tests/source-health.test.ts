import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import type { RawSignal, SourceCollection, SourceHealth, SourceContext } from "../src/types.js";
import { runSafeSource as executeSafeSource, type SafeSourceOptions, type SourceCollector } from "../src/sources/source.js";

async function testContext(): Promise<SourceContext> {
  return {
    workspaceRoot: "/tmp/task-5-source-health",
    fetchedAt: "2026-08-24T00:00:00.000Z",
    config: await loadConfig({ workspaceRoot: "/tmp/task-5-source-health" }),
  };
}

async function runSafeSource(sourceType: SourceHealth["sourceType"], collect: SourceCollector, options: Omit<SafeSourceOptions, "context"> = {}) {
  return executeSafeSource(sourceType, collect, { ...options, context: await testContext() });
}

function health(sourceType: SourceHealth["sourceType"], overrides: Partial<SourceHealth> = {}): SourceHealth {
  return {
    sourceType,
    status: "available",
    attemptedAt: "2026-08-24T00:00:00.000Z",
    itemCount: 1,
    failureReasons: [],
    coverageNotes: [],
    ...overrides,
  };
}

function signal(id: string, sourceType: RawSignal["sourceType"] = "fixtures"): RawSignal {
  return {
    id, sourceType, sourceName: "Fixture", sourceUrl: `https://example.com/${id}`,
    title: id, fetchedAt: "2026-08-24T00:00:00.000Z", sourceTier: "first_party",
    sourceFingerprint: id, evidenceStatus: "verified",
  };
}

function collection(sourceType: SourceHealth["sourceType"], signals: RawSignal[], overrides: Partial<SourceHealth> = {}): SourceCollection {
  return { signals, health: health(sourceType, { itemCount: signals.length, ...overrides }) };
}

describe("runSafeSource", () => {
  it("returns successful items with available health", async () => {
    let receivedContext: SourceContext | undefined;
    const result = await runSafeSource("fixtures", async (context) => {
      receivedContext = context;
      return collection("fixtures", [signal("one")]);
    });
    expect(result.signals).toHaveLength(1);
    expect(result.health.status).toBe("available");
    expect(result.health.itemCount).toBe(1);
    expect(receivedContext?.workspaceRoot).toBe("/tmp/task-5-source-health");
  });

  it("maps a valid empty response to empty, not failed", async () => {
    const result = await runSafeSource("fixtures", async () => collection("fixtures", [], { itemCount: 0 }));
    expect(result.health.status).toBe("empty");
    expect(result.health.failureReasons).toEqual([]);
  });

  it("preserves partial multi-endpoint health and coverage notes", async () => {
    const result = await runSafeSource("reddit-feed", async () => collection("reddit-feed", [signal("one", "reddit-feed")], {
      status: "partial", endpointCount: 2, successfulEndpointCount: 1, coverageNotes: ["community B returned 403"],
    }));
    expect(result.health.status).toBe("partial");
    expect(result.health.endpointCount).toBe(2);
    expect(result.health.coverageNotes.join(" ")).toContain("403");
  });

  it("classifies thrown errors and never reports failed coverage as empty", async () => {
    const result = await runSafeSource("github", async () => { throw new Error("database unavailable"); });
    expect(result.signals).toEqual([]);
    expect(result.health.status).toBe("unverified");
    expect(result.health.failureReasons.join(" ")).toContain("database unavailable");
    expect(result.health.status).not.toBe("empty");
  });

  it.each(["HTTP 401 Unauthorized", "HTTP 403 Forbidden", "HTTP 404 Not Found", "HTTP 429 Too Many Requests", "invalid JSON response", "missing credentials"])("does not retry non-transient error %s", async (message) => {
    let attempts = 0;
    const result = await runSafeSource("reddit-feed", async () => {
      attempts += 1;
      throw new Error(message);
    });
    expect(attempts).toBe(1);
    expect(result.health.status).toBe("blocked");
    expect(result.health.failureReasons.join(" ")).toContain(message);
  });

  it("classifies numeric HTTP status and network error codes without relying on message text", async () => {
    let attempts = 0;
    const result = await runSafeSource("reddit-feed", async () => {
      attempts += 1;
      throw Object.assign(new Error("request failed"), { status: 429 });
    });
    expect(attempts).toBe(1);
    expect(result.health.status).toBe("blocked");
    expect(result.health.failureReasons.join(" ")).toContain("rate_limited");
  });

  it("retries one transient network error with bounded delay and then succeeds", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const collector: SourceCollector = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("ECONNRESET network failure");
      return collection("github", [signal("recovered", "github")]);
    };
    const result = await runSafeSource("github", collector, {
      retryDelayMs: 25,
      sleep: async (delayMs) => { delays.push(delayMs); },
    });
    expect(attempts).toBe(2);
    expect(delays).toEqual([25]);
    expect(result.health.status).toBe("available");
    expect(result.signals[0]?.id).toBe("recovered");
  });

  it("caps an adapter-provided retry delay", async () => {
    const delays: number[] = [];
    const result = await runSafeSource("github", async () => { throw new Error("ECONNRESET"); }, {
      retryDelayMs: 999_999, sleep: async (delayMs) => { delays.push(delayMs); },
    });
    expect(delays).toEqual([1_000]);
    expect(result.health.status).toBe("unverified");
  });

  it("keeps the original transient error category after the bounded retry is exhausted", async () => {
    let attempts = 0;
    const result = await runSafeSource("github", async () => {
      attempts += 1;
      throw new Error("ETIMEDOUT network failure");
    }, { retryDelayMs: 1, sleep: async () => {} });
    expect(attempts).toBe(2);
    expect(result.health.status).toBe("unverified");
    expect(result.health.failureReasons.join(" ")).toContain("ETIMEDOUT");
  });

  it("turns malformed signals into an unverified source failure", async () => {
    const malformed = { signals: [{ id: "missing-required-fields" }], health: health("github") } as unknown as SourceCollection;
    const result = await runSafeSource("github", async () => malformed, { attemptedAt: "2026-08-24T12:00:00.000Z" });
    expect(result.signals).toEqual([]);
    expect(result.health.status).toBe("unverified");
    expect(result.health.failureReasons.join(" ")).toMatch(/raw signal|invalid/i);
  });

  it("turns a collection missing health or signals into an unverified source failure", async () => {
    const result = await runSafeSource("github", async () => ({ signals: [] } as unknown as SourceCollection));
    expect(result.signals).toEqual([]);
    expect(result.health.status).toBe("unverified");
    expect(result.health.failureReasons.join(" ")).toContain("missing signals or health");
  });

  it("turns malformed health metadata into an unverified source failure", async () => {
    const malformed = { signals: [signal("one", "github")], health: { sourceType: "github", status: "available" } } as unknown as SourceCollection;
    const result = await runSafeSource("github", async () => malformed);
    expect(result.signals).toEqual([]);
    expect(result.health.status).toBe("unverified");
    expect(result.health.failureReasons.join(" ")).toMatch(/health|invalid/i);
  });

  it("rejects health from a different source type", async () => {
    const mismatched = collection("github", [signal("one", "github")]);
    const result = await runSafeSource("reddit-feed", async () => mismatched);
    expect(result.signals).toEqual([]);
    expect(result.health.status).toBe("unverified");
    expect(result.health.failureReasons.join(" ")).toContain("sourceType");
  });

  it("rejects a parsed signal whose source type differs from the executor", async () => {
    const result = await runSafeSource("github", async () => collection("github", [signal("wrong", "fixtures")]));
    expect(result.signals).toEqual([]);
    expect(result.health.status).toBe("unverified");
    expect(result.health.failureReasons.join(" ")).toContain("signal sourceType mismatch");
    expect(result.health.coverageNotes.join(" ")).toContain("signal sourceType mismatch");
  });

  it("uses executor attemptedAt instead of collector health attemptedAt", async () => {
    const result = await runSafeSource("fixtures", async () => collection("fixtures", [signal("one")], {
      attemptedAt: "not-a-date",
    }), { attemptedAt: "2026-08-24T12:34:56.000Z" });
    expect(result.health.attemptedAt).toBe("2026-08-24T12:34:56.000Z");
  });
});
