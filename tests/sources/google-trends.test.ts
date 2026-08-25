import { describe, expect, it } from "vitest";
import { isFreshTrendSnapshot, parseManualTrendsSnapshot, resolveGoogleTrends, type ManualTrendsSnapshotInput } from "../../src/sources/google-trends.js";

describe("Google Trends optional verification boundary", () => {
  it("parses a manual snapshot with expression and trend fields", () => {
    const snapshot = parseManualTrendsSnapshot({ expression: "new ai tool", capturedAt: "2026-08-24T09:00:00.000Z", window: "24h", region: "US", value: 82, delta: 14, relatedQueries: [{ text: "ai workflow", growth: 22, type: "rising" }], status: "verified" });
    expect(snapshot).toMatchObject({ provider: "google_trends", expressionId: "expression-new ai tool", window: "24h", region: "US", value: 82, delta: 14, status: "verified" });
    expect(snapshot.relatedQueries[0]?.text).toBe("ai workflow");
  });

  it("accepts an explicit expressionId and all supported windows", () => {
    for (const window of ["4h", "24h", "7d", "30d", "12m", "5y"] as const) {
      expect(parseManualTrendsSnapshot({ expressionId: "expression-ai", capturedAt: "2026-08-24T09:00:00Z", window, status: "partial" }).expressionId).toBe("expression-ai");
    }
  });

  it("defaults manual snapshots to unavailable", () => {
    const snapshot = parseManualTrendsSnapshot({ expression: "AI", capturedAt: "2026-08-24T09:00:00Z", window: "24h" });
    expect(snapshot.status).toBe("unavailable");
  });

  it("marks snapshots older than their selected window stale", () => {
    const referenceAt = "2026-08-25T12:00:00.000Z";
    const fresh = parseManualTrendsSnapshot({ expressionId: "expression-ai", capturedAt: "2026-08-24T13:00:00.000Z", window: "24h", status: "verified" });
    const stale = parseManualTrendsSnapshot({ expressionId: "expression-ai", capturedAt: "2026-08-24T11:59:59.000Z", window: "24h", status: "verified" });
    expect(isFreshTrendSnapshot(fresh, referenceAt)).toBe(true);
    expect(isFreshTrendSnapshot(stale, referenceAt)).toBe(false);
  });

  it("returns unavailable without a provider instead of inventing zero or decline", async () => {
    const snapshot = await resolveGoogleTrends({ expression: "AI workflow", capturedAt: "2026-08-24T09:00:00Z", window: "24h", region: "US" });
    expect(snapshot).toMatchObject({ provider: "google_trends", status: "unavailable", expressionId: "expression-ai workflow" });
    expect(snapshot.value).toBeUndefined();
    expect(snapshot.delta).toBeUndefined();
  });

  it("does not persist provider credentials from manual input", () => {
    const snapshot = parseManualTrendsSnapshot({ expression: "AI", capturedAt: "2026-08-24T09:00:00Z", window: "24h", status: "verified", apiKey: "secret" } as ManualTrendsSnapshotInput & { apiKey: string });
    expect(JSON.stringify(snapshot)).not.toContain("secret");
  });
});
