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
});
