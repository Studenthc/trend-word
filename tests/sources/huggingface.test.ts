import { describe, expect, it } from "vitest";
import { createHuggingFaceAdapter, type HuggingFaceTransport } from "../../src/sources/huggingface.js";
import type { SourceContext } from "../../src/types.js";

const context = { workspaceRoot: "/tmp", fetchedAt: "2026-09-03T00:00:00.000Z", config: {} } as SourceContext;

function response(body: unknown, status = 200): Awaited<ReturnType<HuggingFaceTransport>> {
  return { status, headers: new Headers({ "content-type": "application/json" }), text: async () => JSON.stringify(body) };
}

describe("Hugging Face model catalog adapter", () => {
  it("requests a bounded recent catalog and maps task types and metrics", async () => {
    const urls: string[] = [];
    const result = await createHuggingFaceAdapter(async (request) => {
      urls.push(request.url);
      return response({ items: [{ id: "acme/image-to-video", modelId: "acme/image-to-video", lastModified: "2026-09-02T00:00:00.000Z", pipeline_tag: "image-to-video", tags: ["video"], likes: 12, downloads: 900 }] });
    }, { recentDays: 7, limit: 3 }).collect(context);

    const requestUrl = new URL(urls[0]!);
    expect(requestUrl.origin + requestUrl.pathname).toBe("https://huggingface.co/api/models");
    expect(requestUrl.searchParams.get("sort")).toBe("lastModified");
    expect(requestUrl.searchParams.get("direction")).toBe("-1");
    expect(requestUrl.searchParams.get("limit")).toBe("3");
    expect(result.models[0]).toMatchObject({ id: "huggingface:acme/image-to-video", modelName: "acme/image-to-video", inputTypes: ["image"], outputTypes: ["video"], publicMetrics: { likes: 12, downloads: 900 }, evidenceStatus: "verified" });
    expect(result.health).toMatchObject({ status: "available", itemCount: 1 });
  });

  it("filters old models, deduplicates IDs, and keeps an undated model as partial", async () => {
    const result = await createHuggingFaceAdapter(async () => response({
      items: [
        { id: "acme/old", lastModified: "2026-08-01T00:00:00.000Z", pipeline_tag: "text-to-image" },
        { id: "acme/undated", pipeline_tag: "text-to-video" },
        { id: "acme/undated", pipeline_tag: "text-to-video" },
      ],
    }), { recentDays: 7, limit: 10 }).collect(context);

    expect(result.models.map((model) => model.id)).toEqual(["huggingface:acme/undated"]);
    expect(result.models[0]).toMatchObject({ evidenceStatus: "partial", notes: [expect.stringMatching(/timestamp/i)] });
    expect(result.health.status).toBe("partial");
  });

  it.each([403, 429])("maps HTTP %s to blocked instead of empty", async (status) => {
    const result = await createHuggingFaceAdapter(async () => response({ error: "limited" }, status)).collect(context);
    expect(result.models).toEqual([]);
    expect(result.health.status).toBe("blocked");
    expect(result.health.status).not.toBe("empty");
  });

  it("maps malformed JSON to unverified", async () => {
    const result = await createHuggingFaceAdapter(async () => ({ status: 200, headers: new Headers(), text: async () => "not-json" })).collect(context);
    expect(result.models).toEqual([]);
    expect(result.health.status).toBe("unverified");
    expect(result.health.failureReasons.join(" ")).toMatch(/JSON|parse/i);
  });
});
