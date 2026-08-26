import { describe, expect, it } from "vitest";
import { extractSeedTerms } from "../src/domain/seed-terms.js";
import type { RawSignal } from "../src/types.js";

function signal(changes: Partial<RawSignal> = {}): RawSignal {
  return {
    id: "seed-signal", sourceType: "scys-mcp", sourceName: "SCYS", sourceUrl: "https://scys.com/topic/seed-signal", externalId: "seed-signal",
    title: "AI 圈新词：wan animate 与工作流机会", body: "评论区有人问‘有没有演唱会调色修图工具’，作者提到“wan animate”，并描述保存失败、尺寸不对。",
    author: { name: "作者" }, publishedAt: "2026-08-25T00:00:00.000Z", fetchedAt: "2026-08-25T00:00:00.000Z", sourceTier: "community", sourceFingerprint: "seed-signal", evidenceStatus: "verified", ...changes,
  };
}

describe("extractSeedTerms", () => {
  it("extracts quoted concepts, concrete search phrases, and problems", () => {
    const terms = extractSeedTerms(signal());
    expect(terms.map((item) => item.text)).toEqual(expect.arrayContaining(["wan animate", "演唱会调色修图工具", "保存失败", "尺寸不对"]));
    expect(terms.find((item) => item.text === "演唱会调色修图工具")?.location).toBe("body");
  });

  it("extracts a repository product without using the owner prefix", () => {
    const terms = extractSeedTerms(signal({ sourceType: "github", title: "acme/flowpilot", body: "Workflow automation for teams." }));
    expect(terms.map((item) => item.text)).toContain("flowpilot");
    expect(terms.map((item) => item.text)).not.toContain("acme/flowpilot");
  });

  it("rejects generic source noise", () => {
    expect(extractSeedTerms(signal({ title: "AI 风向标：新玩法", body: "AI、出海、赚钱、创业。" }))).toEqual([]);
  });

  it("extracts unquoted domain phrases from ordinary user language", () => {
    const terms = extractSeedTerms(signal({
      body: "最近大家开始做 AI 原生工作流，很多人还在讨论一人公司自动化。有人说陪跑式交付比卖模板更容易成交。",
    }));
    expect(terms.map((item) => item.text)).toEqual(expect.arrayContaining(["AI 原生工作流", "一人公司自动化", "陪跑式交付"]));
    expect(terms.find((item) => item.text === "一人公司自动化")?.quote).toContain("一人公司自动化");
    expect(terms.map((item) => item.text)).not.toContain("AI");
  });
});
