import { describe, expect, it } from "vitest";
import { normalizeScysBrowserItems } from "../../scripts/scys-browser-runtime.mjs";

describe("SCYS browser runtime normalization", () => {
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
});
