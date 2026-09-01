import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RawSignal } from "../../src/types.js";
import { enrichSignalsWithDetails, fetchEntityDetail, mergeEntityDetail } from "../../src/sources/details.js";

function signal(sourceType: "github" | "producthunt", changes: Partial<RawSignal> = {}): RawSignal {
  return {
    id: `${sourceType}-1`, sourceType, sourceName: sourceType, sourceUrl: sourceType === "github" ? "https://github.com/acme/flowpilot" : "https://producthunt.com/posts/flowpilot", externalId: sourceType === "github" ? "acme/flowpilot" : "ph-1", title: "FlowPilot", excerpt: "Short summary", fetchedAt: "2026-08-30T00:00:00.000Z", sourceTier: sourceType === "github" ? "first_party" : "market", sourceFingerprint: `${sourceType}-1`, evidenceStatus: "verified", ...changes,
  };
}

describe("entity details", () => {
  it("decodes a GitHub README response into detail text", async () => {
    const response = await fetchEntityDetail(signal("github"), async (request) => ({ status: 200, headers: new Headers(), text: async () => JSON.stringify({ content: Buffer.from("Users replace Zapier for repetitive workflows.").toString("base64"), encoding: "base64" }) }));
    expect(response).toMatchObject({ status: "success", body: "Users replace Zapier for repetitive workflows." });
  });

  it("returns a named failure and never follows an untrusted detail URL", async () => {
    const response = await fetchEntityDetail(signal("github", { externalId: "127.0.0.1/secret", sourceUrl: "http://127.0.0.1/secret" }), async () => { throw new Error("must not request"); });
    expect(response).toMatchObject({ status: "failed", errorCode: "detail_url_not_allowed" });
  });

  it("accepts the official www Product Hunt host", async () => {
    const response = await fetchEntityDetail(signal("producthunt", { sourceUrl: "https://www.producthunt.com/posts/flowpilot" }), async () => ({ status: 200, headers: new Headers(), text: async () => JSON.stringify({ data: { post: { description: "Users need this workflow" } } }) }));
    expect(response).toMatchObject({ status: "success", body: "Users need this workflow" });
  });

  it("merges longer detail text without overwriting the source identity", () => {
    const result = mergeEntityDetail(signal("github"), { status: "success", body: "A longer README describing the user task.", fetchedAt: "2026-08-30T00:00:00.000Z" });
    expect(result).toMatchObject({ id: "github-1", title: "FlowPilot", body: "A longer README describing the user task.", excerpt: "Short summary" });
  });

  it("limits enrichment and reuses the detail cache", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "trend-word-details-"));
    let calls = 0;
    const transport = async () => { calls += 1; return { status: 200, headers: new Headers(), text: async () => JSON.stringify({ content: Buffer.from("README user task").toString("base64"), encoding: "base64" }) }; };
    await enrichSignalsWithDetails([signal("github"), signal("github", { id: "github-2", externalId: "acme/flowpilot-2", sourceUrl: "https://github.com/acme/flowpilot-2" })], { github: transport }, root, "2026-08-30T00:00:00.000Z", 1);
    await enrichSignalsWithDetails([signal("github")], { github: transport }, root, "2026-08-30T00:00:00.000Z", 1);
    expect(calls).toBe(1);
  });
});
