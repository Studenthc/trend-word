import { describe, expect, it } from "vitest";
import { createProductHuntAdapter, type HttpTransport } from "../../src/sources/producthunt.js";
import type { SourceContext } from "../../src/types.js";

const context = { workspaceRoot: "/tmp", fetchedAt: "2026-08-24T00:00:00.000Z", config: {} } as SourceContext;

function response(body: unknown, status = 200): Awaited<ReturnType<HttpTransport>> {
  return { status, headers: new Headers({ "content-type": "application/json" }), text: async () => JSON.stringify(body) };
}

describe("Product Hunt adapter", () => {
  it("maps an offline launch feed and preserves launch fields", async () => {
    const transport: HttpTransport = async () => response({ data: { posts: { edges: [{ node: { id: "42", name: "FlowPilot", tagline: "AI workflow copilot", url: "https://producthunt.com/posts/flowpilot", createdAt: "2026-08-23T10:00:00.000Z", votesCount: 321, user: { id: "maker-1", name: "Maker", url: "https://producthunt.com/@maker" }, commentsCount: 12 } }] } } });
    const result = await createProductHuntAdapter(transport).collect(context);
    expect(result.health).toMatchObject({ sourceType: "producthunt", status: "available", itemCount: 1 });
    expect(result.signals[0]).toMatchObject({ sourceUrl: "https://producthunt.com/posts/flowpilot", title: "FlowPilot", excerpt: "AI workflow copilot", publishedAt: "2026-08-23T10:00:00.000Z", author: { name: "Maker" }, engagement: { likes: 321, votes: 321, comments: 12 } });
  });

  it("marks missing comments as partial without losing the launch", async () => {
    const transport: HttpTransport = async () => response({ posts: [{ id: "43", name: "NoComment", tagline: "A launch", url: "https://producthunt.com/posts/no-comment", createdAt: "2026-08-23T10:00:00.000Z", votesCount: 4, user: { name: "Maker" } }] });
    const result = await createProductHuntAdapter(transport).collect(context);
    expect(result.signals).toHaveLength(1);
    expect(result.health.status).toBe("partial");
    expect(result.health.coverageNotes.join(" ")).toMatch(/comment/i);
  });

  it("returns unverified health for malformed launch JSON", async () => {
    const transport: HttpTransport = async () => ({ status: 200, headers: new Headers(), text: async () => "not json" });
    const result = await createProductHuntAdapter(transport).collect(context);
    expect(result.signals).toEqual([]);
    expect(result.health.status).toBe("unverified");
    expect(result.health.failureReasons.join(" ")).toMatch(/parse|json/i);
  });
});
