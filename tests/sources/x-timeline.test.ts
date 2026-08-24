import { describe, expect, it } from "vitest";
import { createXTimelineAdapter, type HttpTransport } from "../../src/sources/x-timeline.js";
import type { SourceContext } from "../../src/types.js";

const context = { workspaceRoot: "/tmp", fetchedAt: "2026-08-25T00:00:00.000Z", config: {} } as SourceContext;

function response(body: unknown, status = 200): Awaited<ReturnType<HttpTransport>> {
  return { status, headers: new Headers({ "content-type": "application/json" }), text: async () => JSON.stringify(body) };
}

describe("X timeline adapter", () => {
  it("queries only configured handles and maps known-account timeline items", async () => {
    const urls: string[] = [];
    const transport: HttpTransport = async (request) => {
      urls.push(request.url);
      const handle = request.url.endsWith("alice/tweets") ? "alice" : "bob";
      return response({ data: [{ id: `${handle}-1`, text: `${handle} workflow`, author: handle, created_at: "2026-08-24T08:00:00.000Z", url: `https://x.com/${handle}/status/1`, public_metrics: { like_count: 4, reply_count: 2 } }] });
    };
    const result = await createXTimelineAdapter(transport, { handles: ["alice", "bob"] }).collect(context);
    expect(urls).toEqual(["https://api.x.example/timeline/alice/tweets", "https://api.x.example/timeline/bob/tweets"]);
    expect(urls.join(" ")).not.toMatch(/search/i);
    expect(result.signals).toHaveLength(2);
    expect(result.health).toMatchObject({ sourceType: "x-timeline", status: "available", endpointCount: 2, successfulEndpointCount: 2, itemCount: 2 });
  });

  it("marks an unavailable account partial while retaining another account's signals", async () => {
    const result = await createXTimelineAdapter(async (request) => request.url.includes("missing") ? response({}, 404) : response({ data: [{ id: "ok-1", text: "Known account post", author: "ok", created_at: "2026-08-24T08:00:00.000Z" }] }), { handles: ["missing", "ok"] }).collect(context);
    expect(result.signals).toHaveLength(1);
    expect(result.health.status).toBe("partial");
    expect(result.health.failureReasons.join(" ")).toMatch(/missing|404|unavailable/i);
  });

  it("treats successful empty timelines as empty, without querying other accounts", async () => {
    const result = await createXTimelineAdapter(async () => response({ data: [] }), { handles: ["alice"] }).collect(context);
    expect(result.signals).toEqual([]);
    expect(result.health.status).toBe("empty");
  });

  it("retries one transient endpoint failure and keeps the recovered signal", async () => {
    let attempts = 0;
    const result = await createXTimelineAdapter(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("ETIMEDOUT");
      return response({ data: [{ id: "recovered", text: "Recovered post", author: "alice" }] });
    }, { handles: ["alice"] }).collect(context);
    expect(attempts).toBe(2);
    expect(result.signals).toHaveLength(1);
    expect(result.health.status).toBe("available");
  });

  it("bounds transient retries at one retry", async () => {
    let attempts = 0;
    const result = await createXTimelineAdapter(async () => { attempts += 1; throw new Error("fetch failed"); }, { handles: ["alice"] }).collect(context);
    expect(attempts).toBe(2);
    expect(result.health.status).toBe("unverified");
  });
});
