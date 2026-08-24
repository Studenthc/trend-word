import { describe, expect, it } from "vitest";
import type { RawSignal } from "../../src/types.js";
import { importManualSignals } from "../../src/sources/manual.js";

const previous: RawSignal = {
  id: "previous", sourceType: "manual", sourceName: "Previous", sourceUrl: "https://previous.example/item",
  title: "Existing signal", fetchedAt: "2026-08-23T00:00:00.000Z", sourceTier: "community",
  sourceFingerprint: "previous", evidenceStatus: "verified",
};

describe("manual signal import", () => {
  it("imports JSONL aliases and preserves previous signals", () => {
    const input = [
      JSON.stringify({ source_url: "https://example.com/json", headline: "JSON title", content: "JSON body", authorName: "Alice", published_at: "2026-08-24T01:00:00Z", source_type: "github" }),
      JSON.stringify({ sourceUrl: "https://example.com/json-2", title: "Second", body: "Second body", author: { name: "Bob" }, publishedAt: "2026-08-24T02:00:00Z", sourceType: "manual" }),
    ].join("\n");
    const result = importManualSignals(input, { format: "jsonl", previous: [previous], fetchedAt: "2026-08-24T03:00:00Z" });
    expect(result.errors).toEqual([]);
    expect(result.signals.map((item) => item.id)).toEqual(["previous", "manual-1", "manual-2"]);
    expect(result.signals[1]).toMatchObject({ sourceType: "github", sourceUrl: "https://example.com/json", title: "JSON title", body: "JSON body", author: { name: "Alice" } });
  });

  it("imports CSV aliases including quoted commas", () => {
    const input = [
      "url,name,description,author,published_at,source_type",
      "https://example.com/csv,\"CSV title, with comma\",CSV body,Alice,2026-08-24T01:00:00Z,producthunt",
    ].join("\n");
    const result = importManualSignals(input, { format: "csv", fetchedAt: "2026-08-24T03:00:00Z" });
    expect(result.errors).toEqual([]);
    expect(result.signals[0]).toMatchObject({ sourceUrl: "https://example.com/csv", title: "CSV title, with comma", body: "CSV body", sourceType: "producthunt" });
  });

  it("reports invalid JSONL and CSV rows with physical row numbers without replacing previous data", () => {
    const jsonl = "{\"sourceUrl\":\"https://example.com/good\",\"title\":\"Good\"}\nnot json\n{\"title\":\"Missing URL\"}";
    const jsonResult = importManualSignals(jsonl, { format: "jsonl", previous: [previous], fetchedAt: "2026-08-24T03:00:00Z" });
    expect(jsonResult.signals.map((item) => item.id)).toEqual(["previous", "manual-1"]);
    expect(jsonResult.errors.map((error) => error.row)).toEqual([2, 3]);

    const csv = "sourceUrl,title\nhttps://example.com/good,Good\nhttps://example.com/bad\n";
    const csvResult = importManualSignals(csv, { format: "csv", previous: [previous], fetchedAt: "2026-08-24T03:00:00Z" });
    expect(csvResult.signals[0]?.id).toBe("previous");
    expect(csvResult.errors.map((error) => error.row)).toEqual([3]);
  });
});
