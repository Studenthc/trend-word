import { describe, expect, it } from "vitest";
import { createRedditFeedAdapter, type HttpTransport } from "../../src/sources/reddit-feed.js";
import type { SourceContext } from "../../src/types.js";

const context = { workspaceRoot: "/tmp", fetchedAt: "2026-08-25T00:00:00.000Z", config: {} } as SourceContext;

function response(text: string, status = 200): Awaited<ReturnType<HttpTransport>> {
  return { status, headers: new Headers({ "content-type": "application/json" }), text: async () => text };
}

const post = { id: "post-1", title: "Practical workflow", selftext: "A useful workflow", url: "https://reddit.com/r/AI/comments/post-1", author: "builder", created_utc: 1756080000, score: 12 };

describe("Reddit feed adapter", () => {
  it("queries only configured communities and aggregates valid posts", async () => {
    const communities: string[] = [];
    const result = await createRedditFeedAdapter(async (request) => { communities.push(request.url.split("/r/")[1]!.split("/")[0]!); return response(JSON.stringify({ data: { children: [{ data: post }] } })); }, { communities: ["AI", "Entrepreneur"] }).collect(context);
    expect(communities).toEqual(["AI", "Entrepreneur"]);
    expect(result.signals).toHaveLength(2);
    expect(result.health).toMatchObject({ sourceType: "reddit-feed", status: "available", endpointCount: 2, successfulEndpointCount: 2 });
  });

  it("keeps one community's posts when another is forbidden or rate limited", async () => {
    const result = await createRedditFeedAdapter(async (request) => request.url.includes("forbidden") ? response("", 403) : request.url.includes("limited") ? response("", 429) : response(JSON.stringify({ data: { children: [{ data: post }] } })), { communities: ["ok", "forbidden", "limited"] }).collect(context);
    expect(result.signals).toHaveLength(1);
    expect(result.health.status).toBe("partial");
    expect(result.health.failureReasons.join(" ")).toMatch(/403|429/);
  });

  it("maps timeout to unverified when it is the only community failure", async () => {
    const result = await createRedditFeedAdapter(async () => { throw new Error("ETIMEDOUT"); }, { communities: ["timeout"] }).collect(context);
    expect(result.signals).toEqual([]);
    expect(result.health.status).toBe("unverified");
    expect(result.health.failureReasons.join(" ")).toMatch(/timeout|ETIMEDOUT/i);
  });

  it("distinguishes a legal empty feed from a failed feed", async () => {
    const result = await createRedditFeedAdapter(async () => response(JSON.stringify({ data: { children: [] } })), { communities: ["empty"] }).collect(context);
    expect(result.signals).toEqual([]);
    expect(result.health.status).toBe("empty");
  });

  it("parses RSS text through the injected parser boundary", async () => {
    const rss = `<rss><channel><item><guid>rss-1</guid><title>RSS workflow</title><link>https://reddit.com/r/AI/comments/rss-1</link><description>RSS body</description><pubDate>Mon, 25 Aug 2026 00:00:00 GMT</pubDate><author>rss-user</author></item></channel></rss>`;
    const result = await createRedditFeedAdapter(async () => response(rss, 200), { communities: ["AI"], parser: "rss" }).collect(context);
    expect(result.signals[0]).toMatchObject({ externalId: "rss-1", title: "RSS workflow", body: "RSS body", author: { name: "rss-user" } });
  });

  it("retries one transient community failure and keeps recovered posts", async () => {
    let attempts = 0;
    const result = await createRedditFeedAdapter(async () => { attempts += 1; if (attempts === 1) throw new Error("ECONNRESET"); return response(JSON.stringify({ data: { children: [{ data: post }] } })); }, { communities: ["AI"] }).collect(context);
    expect(attempts).toBe(2);
    expect(result.signals).toHaveLength(1);
    expect(result.health.status).toBe("available");
  });

  it("rejects malformed RSS instead of treating it as an empty feed", async () => {
    const result = await createRedditFeedAdapter(async () => response("<not-a-feed>", 200), { communities: ["AI"], parser: "rss" }).collect(context);
    expect(result.signals).toEqual([]);
    expect(result.health.status).toBe("unverified");
    expect(result.health.failureReasons.join(" ")).toMatch(/RSS|feed|parse/i);
  });

  it("rejects malformed page documents instead of treating them as empty", async () => {
    const result = await createRedditFeedAdapter(async () => response("plain text", 200), { communities: ["AI"], parser: "page" }).collect(context);
    expect(result.signals).toEqual([]);
    expect(result.health.status).toBe("unverified");
    expect(result.health.failureReasons.join(" ")).toMatch(/page|feed|parse/i);
  });

  it("does not retry a rate-limited community", async () => {
    let attempts = 0;
    const result = await createRedditFeedAdapter(async () => { attempts += 1; return response("", 429); }, { communities: ["AI"] }).collect(context);
    expect(attempts).toBe(1);
    expect(result.health.status).toBe("blocked");
  });
});
