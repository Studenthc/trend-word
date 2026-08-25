import { describe, expect, it } from "vitest";
import { createGitHubAdapter, type HttpTransport } from "../../src/sources/github.js";
import type { SourceContext } from "../../src/types.js";

const context = { workspaceRoot: "/tmp", fetchedAt: "2026-08-24T00:00:00.000Z", config: {} } as SourceContext;

function response(body: unknown, status = 200): Awaited<ReturnType<HttpTransport>> {
  return { status, headers: new Headers(), text: async () => JSON.stringify(body) };
}

describe("GitHub adapter", () => {
  it("maps repository search fields and README excerpt", async () => {
    const transport: HttpTransport = async () => response({ items: [{ id: 7, full_name: "acme/flowpilot", html_url: "https://github.com/acme/flowpilot", owner: { login: "acme" }, description: "Workflow automation", stargazers_count: 812, language: "TypeScript", created_at: "2026-08-20T00:00:00.000Z", readme_excerpt: "Build workflows with AI." }] });
    const result = await createGitHubAdapter(transport).collect(context);
    expect(result.health).toMatchObject({ sourceType: "github", status: "available", itemCount: 1 });
    expect(result.signals[0]).toMatchObject({ sourceUrl: "https://github.com/acme/flowpilot", title: "acme/flowpilot", body: "Workflow automation", excerpt: "Build workflows with AI.", author: { name: "acme" }, publishedAt: "2026-08-20T00:00:00.000Z", language: "TypeScript", engagement: { stars: 812 } });
  });

  it("uses recent repository activity for candidate freshness", async () => {
    const result = await createGitHubAdapter(async () => response({ items: [{ full_name: "acme/flowpilot", html_url: "https://github.com/acme/flowpilot", owner: { login: "acme" }, description: "Workflow automation", created_at: "2024-01-01T00:00:00.000Z", updated_at: "2026-08-24T00:00:00.000Z" }] })).collect(context);
    expect(result.signals[0]?.publishedAt).toBe("2026-08-24T00:00:00.000Z");
  });

  it("maps rate limiting to blocked rather than empty success", async () => {
    const transport: HttpTransport = async () => response({ message: "API rate limit exceeded" }, 403);
    const result = await createGitHubAdapter(transport).collect(context);
    expect(result.signals).toEqual([]);
    expect(result.health.status).toBe("blocked");
    expect(result.health.failureReasons.join(" ")).toMatch(/403|rate/i);
  });

  it("returns unverified health for malformed repository JSON", async () => {
    const transport: HttpTransport = async () => ({ status: 200, headers: new Headers(), text: async () => "{" });
    const result = await createGitHubAdapter(transport).collect(context);
    expect(result.health.status).toBe("unverified");
    expect(result.health.failureReasons.join(" ")).toMatch(/parse|json/i);
  });

  it("does not turn a null repository item into an empty success", async () => {
    const result = await createGitHubAdapter(async () => response({ items: [null] })).collect(context);
    expect(result.health.status).toBe("unverified");
    expect(result.health.failureReasons.join(" ")).toMatch(/malformed|parse/i);
  });

  it.each([401, 404, 403, 429])("maps HTTP %s to blocked", async (status) => {
    const result = await createGitHubAdapter(async () => response({}, status)).collect(context);
    expect(result.health.status).toBe("blocked");
  });

  it("keeps successful query signals when a later query is rate limited", async () => {
    const result = await createGitHubAdapter(async (request) => {
      if (new URL(request.url).searchParams.get("q") === "failed") return response({}, 429);
      return response({ items: [{ full_name: "acme/success", html_url: "https://github.com/acme/success", owner: { login: "acme" }, description: "Success" }] });
    }, { queries: ["success", "failed"] }).collect(context);
    expect(result.signals.map((signal) => signal.externalId)).toEqual(["acme/success"]);
    expect(result.health.status).toBe("partial");
    expect(result.health.failureReasons.join(" ")).toMatch(/429|rate/i);
  });

  it("deduplicates the same repository returned by multiple queries", async () => {
    const result = await createGitHubAdapter(async () => response({ items: [{ full_name: "acme/repeated", html_url: "https://github.com/acme/repeated", owner: { login: "acme" }, description: "Repeated" }] }), { queries: ["one", "two"] }).collect(context);
    expect(result.signals.map((signal) => signal.externalId)).toEqual(["acme/repeated"]);
    expect(result.health.itemCount).toBe(1);
  });
});
