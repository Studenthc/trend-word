import { describe, expect, it } from "vitest";
import { createModelCatalogAdapter, type ModelCatalogTransport } from "../../src/sources/model-catalog.js";
import type { SourceContext } from "../../src/types.js";

const context = { workspaceRoot: "/tmp", fetchedAt: "2026-09-03T00:00:00.000Z", config: { modelCatalog: { enabled: true, platforms: ["huggingface", "fal-ai"], recentDays: 7, limitPerPlatform: 2 } } } as SourceContext;

function json(body: unknown, status = 200): Awaited<ReturnType<ModelCatalogTransport>> {
  return { status, headers: new Headers({ "content-type": "application/json" }), text: async () => JSON.stringify(body) };
}

function html(body: string, status = 200): Awaited<ReturnType<ModelCatalogTransport>> {
  return { status, headers: new Headers({ "content-type": "text/html" }), text: async () => body };
}

describe("combined model catalog adapter", () => {
  it("returns traceable signals for both platforms", async () => {
    const result = await createModelCatalogAdapter({
      huggingface: async () => json([{ id: "acme/image-to-video", lastModified: "2026-09-02T00:00:00.000Z", pipeline_tag: "image-to-video", tags: [] }]),
      falAi: async () => html(`<a href="/models/acme/video/image-to-video"></a>`),
    }).collect(context);

    expect(result.modelRecords).toHaveLength(2);
    expect(result.signals).toHaveLength(2);
    expect(result.signals).toEqual(expect.arrayContaining([expect.objectContaining({ sourceType: "model-catalog", sourceName: "Hugging Face", signalKind: "entity", tags: expect.arrayContaining(["model-catalog:huggingface"]) }), expect.objectContaining({ sourceName: "fal.ai", tags: expect.arrayContaining(["model-catalog:fal-ai"]) })]));
    expect(result.health.status).toBe("partial");
    expect(result.health.coverageNotes.join(" ")).toMatch(/huggingface: available/);
    expect(result.health.coverageNotes.join(" ")).toMatch(/fal-ai: partial/);
  });

  it("keeps one platform's models when the other platform is rate limited", async () => {
    const result = await createModelCatalogAdapter({
      huggingface: async () => json([{ id: "acme/image-to-video", lastModified: "2026-09-02T00:00:00.000Z", pipeline_tag: "image-to-video", tags: [] }]),
      falAi: async () => html("limited", 429),
    }).collect(context);

    expect((result.modelRecords ?? []).map((model) => model.platform)).toEqual(["huggingface"]);
    expect(result.health.status).toBe("partial");
    expect(result.health.failureReasons.join(" ")).toMatch(/fal.ai.*429/i);
  });
});
