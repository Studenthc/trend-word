import { describe, expect, it } from "vitest";
import { createScysBrowserTransport, extractScysSearchRows, normalizeScysBrowserItems } from "../../scripts/scys-browser-runtime.mjs";

describe("SCYS browser runtime normalization", () => {
  it("does not treat background document cards as results when the search modal is empty", () => {
    expect(extractScysSearchRows({ information: [], cards: [], backgroundCards: ["旧 query 结果"] })).toEqual([]);
  });

  it("preserves visible metadata and marks search-only content as partial", () => {
    expect(normalizeScysBrowserItems(
      [{ title: "视频号AI短剧带货变现逻辑与实操流程", content: "" }],
      [{ title: "视频号AI短剧带货变现逻辑与实操流程", author: "大臣", date: "2026-08-18" }],
      "短剧",
      "https://scys.com/activity/documents?id=10095&index=1",
    )).toEqual([expect.objectContaining({
      id: "live-短剧-0",
      author: { name: "大臣" },
      publishedAt: "2026-08-17T16:00:00.000Z",
      evidenceStatus: "partial",
      syncWarnings: ["SCYS browser search result captured; full detail body not fetched"],
    })]);
  });

  it("deduplicates repeated visible rows by title", () => {
    const rows = normalizeScysBrowserItems(
      [{ title: "同一资料", content: "" }, { title: "同一资料", content: "" }],
      [],
      "AI",
      "https://scys.com/activity/documents?id=10095&index=1",
    );
    expect(rows).toHaveLength(2);
  });

  it("opens the visible SCYS result and uses the detail page body as evidence", async () => {
    let detailOpened = false;
    const sourceInfo = { id: "source-tab", url: "https://scys.com/activity/documents?id=10095&index=1" };
    const detailInfo = { id: "detail-tab", url: "https://scys.com/t/BOA7ThzK", title: "资料详情" };
    let sourceEvaluateCalls = 0;
    const sourceTab = {
      playwright: {
        getByPlaceholder: () => ({ count: async () => 1, fill: async () => undefined }),
        getByText: (text: string) => ({ count: async () => text === "资料" ? 1 : 0, click: async () => undefined, last: () => ({ click: async () => undefined }) }),
        waitForTimeout: async () => undefined,
        evaluate: async <T>() => {
          sourceEvaluateCalls += 1;
          return (sourceEvaluateCalls === 1
            ? [{ title: "AI 工作台落地方法", content: "" }]
            : [{ title: "AI 工作台落地方法", author: "三金", date: "2026-08-20" }]) as T;
        },
        locator: (selector: string) => selector === ".information" ? { filter: () => ({ first: () => ({ click: async () => { detailOpened = true; } }) }) } : { count: async () => 0 },
      },
    };
    const detailTab = {
      url: async () => detailInfo.url,
      playwright: {
        waitForTimeout: async () => undefined,
        evaluate: async () => ({ title: "AI 工作台落地方法", body: "正文提到用户会用 AI 工作台解决重复任务。", author: "三金", publishedAt: "2026-08-20T00:00:00.000Z" }),
      },
    };
    const browser = {
      user: {
        openTabs: async () => detailOpened ? [sourceInfo, detailInfo] : [sourceInfo],
        claimTab: async () => detailTab,
      },
    };
    const transport = createScysBrowserTransport(sourceTab, { browser, waitMs: 0 });
    const result = await transport({ method: "content-search", params: { query: "AI" } });
    expect(result).toEqual({ items: [expect.objectContaining({
      title: "AI 工作台落地方法",
      body: "正文提到用户会用 AI 工作台解决重复任务。",
      author: { name: "三金" },
      url: detailInfo.url,
      evidenceStatus: "verified",
    })] });
  });

  it("opens the visible document search entry when the full search modal is not open", async () => {
    let modalOpen = false;
    let evaluated = 0;
    const tab = {
      playwright: {
        getByPlaceholder: (text: string) => ({
          count: async () => text === "请输入关键词" && modalOpen ? 1 : 0,
          fill: async () => undefined,
        }),
        getByText: () => ({ count: async () => 0, last: () => ({ click: async () => undefined }) }),
        waitForTimeout: async () => undefined,
        locator: (selector: string) => selector === ".document-head .search .icon" ? { count: async () => 1, click: async () => { modalOpen = true; } } : undefined,
        evaluate: async <T>() => {
          evaluated += 1;
          return (evaluated === 1 ? [{ title: "AI 工作台", content: "" }] : []) as T;
        },
      },
    };
    const result = await createScysBrowserTransport(tab, { waitMs: 0 })({ method: "content-search", params: { query: "AI" } });
    expect(modalOpen).toBe(true);
    expect(result).toMatchObject({ items: [expect.objectContaining({ title: "AI 工作台", evidenceStatus: "partial" })] });
  });

  it("retries a transient browser timeout without turning the query into empty results", async () => {
    let evaluateCalls = 0;
    const tab = {
      playwright: {
        getByPlaceholder: () => ({ count: async () => 1, fill: async () => undefined }),
        getByText: (text: string) => ({ count: async () => text === "搜索" ? 1 : 0, last: () => ({ click: async () => undefined }) }),
        waitForTimeout: async () => undefined,
        locator: (selector: string) => selector === ".information" ? { filter: () => ({ first: () => ({ click: async () => undefined }) }) } : { count: async () => 0 },
        evaluate: async <T>() => {
          evaluateCalls += 1;
          if (evaluateCalls === 1) throw new Error("Timed out after 3000ms waiting for CDP command Page.getFrameTree");
          return [{ title: "AI 工作台", content: "" }] as T;
        },
      },
    };
    const result = await createScysBrowserTransport(tab, { waitMs: 0 })({ method: "content-search", params: { query: "AI" } });
    expect(evaluateCalls).toBeGreaterThan(1);
    expect(result).toMatchObject({ items: [expect.objectContaining({ title: "AI 工作台" })] });
  });

  it("falls back to the visible result card when search results use the .col layout", async () => {
    let detailOpened = false;
    const sourceInfo = { id: "source-tab", url: "https://scys.com/activity/documents?id=10095&index=1" };
    const detailInfo = { id: "detail-tab", url: "https://scys.com/t/COL123", title: "资料详情" };
    const sourceTab = {
      playwright: {
        getByPlaceholder: () => ({ count: async () => 1, fill: async () => undefined }),
        getByText: () => ({ count: async () => 0, last: () => ({ click: async () => undefined }) }),
        waitForTimeout: async () => undefined,
        evaluate: async <T>() => [{ title: "AI 工作台", content: "" }] as T,
        locator: (selector: string) => selector === ".information"
          ? { filter: () => ({ first: () => ({ click: async () => { throw new Error("no information result"); } }) }) }
          : selector === ".document-head .search .icon"
            ? { count: async () => 0, click: async () => undefined }
            : { filter: () => ({ first: () => ({ click: async () => { detailOpened = true; } }) }) },
      },
    };
    const detailTab = { url: async () => detailInfo.url, playwright: { waitForTimeout: async () => undefined, evaluate: async () => ({ body: "详情正文" }) } };
    const browser = { user: { openTabs: async () => detailOpened ? [sourceInfo, detailInfo] : [sourceInfo], claimTab: async () => detailTab } };
    const result = await createScysBrowserTransport(sourceTab, { browser, waitMs: 0 })({ method: "content-search", params: { query: "AI" } });
    expect(result).toMatchObject({ items: [expect.objectContaining({ body: "详情正文", evidenceStatus: "verified" })] });
  });
});
