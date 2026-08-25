import { describe, expect, it } from "vitest";
import { createScysWebApiTransport } from "../../src/sources/scys-web-api.js";

describe("SCYS web API transport", () => {
  it("maps content-search to the authenticated SCYS endpoint without persisting headers", async () => {
    const calls: Array<{ url: string; init: { method: string; headers?: Record<string, string>; body?: string } }> = [];
    const transport = createScysWebApiTransport(async (url, init) => {
      calls.push({ url, init });
      return { status: 200, json: async () => ({ status: 0, data: { items: [{ id: "42" }] } }) };
    }, { activityId: 10095, headers: { "X-TOKEN": "runtime-only" } });

    await expect(transport({ method: "content-search", params: { query: "短剧" } })).resolves.toEqual({ items: [{ id: "42" }] });
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall!).toMatchObject({ url: "https://scys.com/activity/search/data", init: { method: "POST", headers: { "X-TOKEN": "runtime-only" } } });
    expect(JSON.parse(firstCall!.init.body!)).toEqual({ category: "资料", page: 1, perPage: 20, keyword: "短剧", activity_id: 10095 });
  });

  it("maps topic detail and preserves provider failures", async () => {
    const transport = createScysWebApiTransport(async (url) => {
      if (url.includes("booksdetail")) return { status: 200, json: async () => ({ data: { id: "42", title: "短剧", body: "正文" } }) };
      return { status: 403, json: async () => ({}) };
    }, { activityId: 10095 });
    await expect(transport({ method: "topic-detail", params: { id: "42" } })).resolves.toEqual({ id: "42", title: "短剧", body: "正文" });
    await expect(transport({ method: "content-search", params: { query: "短剧" } })).resolves.toEqual({ status: 403 });
  });
});
