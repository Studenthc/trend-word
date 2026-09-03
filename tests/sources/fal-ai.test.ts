import { describe, expect, it } from "vitest";
import { createFalAiAdapter, type FalAiTransport } from "../../src/sources/fal-ai.js";
import type { SourceContext } from "../../src/types.js";

const context = { workspaceRoot: "/tmp", fetchedAt: "2026-09-03T00:00:00.000Z", config: {} } as SourceContext;

function response(body: string, status = 200): Awaited<ReturnType<FalAiTransport>> {
  return { status, headers: new Headers({ "content-type": "text/html" }), text: async () => body };
}

describe("fal.ai model catalog adapter", () => {
  it("extracts bounded model paths and marks missing catalog timestamps partial", async () => {
    const html = `<a href="/models/minimax/h3-max/image-to-video"><img alt="Image to video with audio" /></a><a href="/models/minimax/h3-max/image-to-video/api">API</a><a href="/models/bytedance/seedance-2.5/image-to-video"><span>Seedance</span></a><a href="/pricing">Pricing</a><script>href="/models/not-a-link"</script>`;
    const result = await createFalAiAdapter(async () => response(html), { limit: 5 }).collect(context);

    expect(result.models).toHaveLength(2);
    expect(result.models[0]).toMatchObject({ platform: "fal-ai", modelUrl: "https://fal.ai/models/minimax/h3-max/image-to-video", inputTypes: ["image"], outputTypes: ["video"], evidenceStatus: "partial", notes: [expect.stringMatching(/timestamp/i)] });
    expect(result.models.map((model) => model.modelName)).toEqual(expect.arrayContaining(["minimax/h3-max/image-to-video", "bytedance/seedance-2.5/image-to-video"]));
    expect(result.health).toMatchObject({ status: "partial", itemCount: 2 });
  });

  it("deduplicates model paths and treats a changed page as unverified", async () => {
    const result = await createFalAiAdapter(async () => response(`<a href="/models/acme/video/image-to-video"></a><a href="https://fal.ai/models/acme/video/image-to-video"></a>`)).collect(context);
    expect(result.models).toHaveLength(1);

    const changed = await createFalAiAdapter(async () => response("<main>Explore</main>")).collect(context);
    expect(changed.models).toEqual([]);
    expect(changed.health.status).toBe("unverified");
  });

  it("does not persist nested page JSON as a model description", async () => {
    const result = await createFalAiAdapter(async () => response(`<a href="/models/acme/video/image-to-video"><img alt="Image to video with audio" /><span>{&quot;x27&quot;:&quot;noise from page state&quot;}</span></a>`)).collect(context);
    expect(result.models[0]?.description).toBe("Image to video with audio");
    expect(result.models[0]?.description).not.toContain("x27");
  });

  it("does not use explore call-to-action text as a model description", async () => {
    const result = await createFalAiAdapter(async () => response(`<a href="/models/acme/video/image-to-video"><span>Try it now! See docs | api</span></a>`)).collect(context);
    expect(result.models[0]?.description).toBeUndefined();
  });

  it.each([403, 429])("maps HTTP %s to blocked", async (status) => {
    const result = await createFalAiAdapter(async () => response("limited", status)).collect(context);
    expect(result.models).toEqual([]);
    expect(result.health.status).toBe("blocked");
  });
});
