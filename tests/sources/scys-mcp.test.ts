import { describe, expect, it } from "vitest";
import { createScysMcpAdapter, type McpTransport } from "../../src/sources/scys-mcp.js";
import type { SourceContext } from "../../src/types.js";

const context = { workspaceRoot: "/tmp", fetchedAt: "2026-08-24T00:00:00.000Z", config: {} } as SourceContext;

describe("SCYS MCP adapter", () => {
  it("combines content search and topic detail without serializing credentials", async () => {
    const requests: unknown[] = [];
    const transport: McpTransport = async (request) => {
      requests.push(request);
      if (request.method === "content-search") return { items: [{ id: "content-1" }] };
      return { id: "content-1", title: "AI workflow", author: { id: "author-1", name: "作者" }, publishedAt: "2026-08-23T08:00:00.000Z", tags: ["AI", "workflow"], body: "A reusable workflow", comments: 8, engagement: { likes: 20 }, permission: "public", syncWarnings: ["comments delayed"] };
    };
    const result = await createScysMcpAdapter(transport).collect(context);
    expect(result.health).toMatchObject({ sourceType: "scys-mcp", status: "partial", itemCount: 1 });
    expect(result.signals[0]).toMatchObject({ externalId: "content-1", title: "AI workflow", body: "A reusable workflow", tags: ["AI", "workflow"], permission: "public", syncWarnings: ["comments delayed"], engagement: { likes: 20, comments: 8 } });
    expect(JSON.stringify(result.signals)).not.toContain("token");
    expect(JSON.stringify(requests)).not.toMatch(/api[_-]?key|secret|authorization/i);
  });

  it("distinguishes a valid zero-result search from a failed MCP call", async () => {
    const empty = await createScysMcpAdapter(async () => ({ items: [] })).collect(context);
    expect(empty.signals).toEqual([]);
    expect(empty.health.status).toBe("empty");
    const failed = await createScysMcpAdapter(async () => { throw new Error("MCP unavailable"); }).collect(context);
    expect(failed.signals).toEqual([]);
    expect(failed.health.status).toBe("unverified");
    expect(failed.health.failureReasons.join(" ")).toMatch(/MCP unavailable/);
  });

  it("preserves permission and sync warnings from a topic detail", async () => {
    const result = await createScysMcpAdapter(async () => ({ items: [{ id: "topic-1", title: "Topic", author: "Author", body: "Body", permission: "restricted", syncWarnings: ["permission delayed"] }] })).collect(context);
    expect(result.signals[0]).toMatchObject({ permission: "restricted", syncWarnings: ["permission delayed"] });
    expect(result.health.status).toBe("partial");
    expect(result.health.coverageNotes.join(" ")).toMatch(/permission|warning/i);
  });

  it("does not turn a null search item into an empty success", async () => {
    const result = await createScysMcpAdapter(async () => ({ items: [null] })).collect(context);
    expect(result.health.status).toBe("unverified");
    expect(result.health.failureReasons.join(" ")).toMatch(/malformed|parse/i);
  });

  it("runs every configured query and keeps successful results when one query fails", async () => {
    const queries: string[] = [];
    const result = await createScysMcpAdapter(async (request) => {
      const query = String(request.params?.query);
      if (request.method === "content-search") queries.push(query);
      if (query === "failed") throw Object.assign(new Error("rate limited"), { status: 429 });
      return { items: [{ id: `content-${query}`, title: `Title ${query}`, body: `Body ${query}`, author: "Author" }] };
    }, { queries: ["first", "failed", "third"] }).collect(context);
    expect(queries).toEqual(["first", "failed", "third"]);
    expect(result.signals.map((signal) => signal.externalId)).toEqual(["content-first", "content-third"]);
    expect(result.health.status).toBe("partial");
    expect(result.health.failureReasons.join(" ")).toMatch(/rate limited/);
  });
});
