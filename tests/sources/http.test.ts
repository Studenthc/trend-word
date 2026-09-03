import { describe, expect, it, vi } from "vitest";
import { createHttpTransport, createProductHuntGraphqlTransport, createRedditFallbackTransport, createXApiTransport } from "../../src/sources/http.js";

describe("default public HTTP transport", () => {
  it("uses fetch with a user agent and returns the adapter response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    const transport = createHttpTransport({ userAgent: "trend-word-test" });

    const response = await transport({ url: "https://api.github.com/search/repositories", method: "GET" });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("{}");
    expect(fetchMock).toHaveBeenCalledWith("https://api.github.com/search/repositories", expect.objectContaining({ method: "GET", headers: { "user-agent": "trend-word-test" } }));
    fetchMock.mockRestore();
  });

  it("builds the official Product Hunt GraphQL request from a runtime token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { posts: [] } }), { status: 200 }));
    process.env.PRODUCT_HUNT_API_TOKEN = "test-token";
    const transport = createProductHuntGraphqlTransport();
    const response = await transport({ url: "https://api.producthunt.com/v2/posts?limit=5", method: "GET" });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.producthunt.com/v2/api/graphql");
    expect(init.headers).toMatchObject({ authorization: "Bearer test-token" });
    expect(String(init.body)).toContain("posts");
    delete process.env.PRODUCT_HUNT_API_TOKEN;
    fetchMock.mockRestore();
  });

  it("resolves an X handle and requests its timeline with the bearer token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "42" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "tweet-1", text: "new expression" }] }), { status: 200 }));
    process.env.X_BEARER_TOKEN = "x-token";
    const transport = createXApiTransport();
    const response = await transport({ url: "https://api.x.example/timeline/karpathy/tweets", method: "GET" });
    expect(response.status).toBe(200);
    expect(JSON.parse(await response.text())).toEqual({ data: [{ id: "tweet-1", text: "new expression" }] });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("users/by/username/karpathy");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("users/42/tweets");
    delete process.env.X_BEARER_TOKEN;
    fetchMock.mockRestore();
  });

  it("falls back from Reddit JSON to RSS after an access denial", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
      .mockResolvedValueOnce(new Response("<rss><channel></channel></rss>", { status: 200, headers: { "content-type": "application/rss+xml" } }));
    const response = await createRedditFallbackTransport()({ url: "https://www.reddit.com/r/SaaS/new.json", method: "GET" });
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("old.reddit.com/r/SaaS/new/.rss");
    fetchMock.mockRestore();
  });

  it("uses the Reddit OAuth endpoint when an access token is available", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { children: [] } }), { status: 200 }));
    process.env.REDDIT_ACCESS_TOKEN = "reddit-token";
    const response = await createRedditFallbackTransport()({ url: "https://www.reddit.com/r/SaaS/new.json", method: "GET" });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("oauth.reddit.com/r/SaaS/new.json");
    expect(init.headers).toMatchObject({ authorization: "Bearer reddit-token" });
    delete process.env.REDDIT_ACCESS_TOKEN;
    fetchMock.mockRestore();
  });
});
