import { describe, expect, it } from "vitest";
import { clusterSeedTerms } from "../src/domain/expression-clusters.js";
import type { RawSignal, SeedTerm } from "../src/types.js";

function signal(id: string, sourceType: RawSignal["sourceType"] = "scys-mcp"): RawSignal {
  return { id, sourceType, sourceName: sourceType, sourceUrl: `https://example.com/${id}`, externalId: id, title: id, body: id, author: { name: id }, community: sourceType, fetchedAt: "2026-08-25T00:00:00.000Z", sourceTier: "community", sourceFingerprint: id, evidenceStatus: "verified" };
}
function seed(text: string, rawSignalId: string, sourceType: SeedTerm["sourceType"] = "scys-mcp"): SeedTerm {
  return { id: `seed-${rawSignalId}`, rawSignalId, text, normalizedText: text.toLocaleLowerCase(), kind: "search_term", location: "body", quote: text, extractionReason: "test", firstSeenAt: "2026-08-25T00:00:00.000Z", sourceType };
}

describe("clusterSeedTerms", () => {
  it("groups English token-order variants and retains the first wording", () => {
    const result = clusterSeedTerms([seed("AI feet generator", "one"), seed("feet generator ai", "two", "github")], [signal("one"), signal("two", "github")], "2026-08-25T00:00:00.000Z");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ primaryTerm: "AI feet generator", aliases: ["feet generator ai"], sourceTypes: ["scys-mcp", "github"] });
  });

  it("does not merge unrelated Chinese scene terms", () => {
    expect(clusterSeedTerms([seed("演唱会调色修图", "one"), seed("追星记账", "two")], [signal("one"), signal("two")], "2026-08-25T00:00:00.000Z")).toHaveLength(2);
  });

  it("merges reposted Product Hunt titles with the same product prefix", () => {
    const result = clusterSeedTerms([
      seed("FlowPilot", "one", "producthunt"),
      seed("FlowPilot AI workflow copilot", "two", "producthunt"),
    ], [signal("one", "producthunt"), signal("two", "producthunt")], "2026-08-25T00:00:00.000Z");
    expect(result).toHaveLength(1);
    expect(result[0]?.aliases).toContain("FlowPilot AI workflow copilot");
  });
});
