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

  it("rejects generic feature phrases while keeping concrete demand language", () => {
    const terms = extractSeedTerms(signal({ body: "最近很多人推荐 AI tools 和 Workflow automation，但有人问有没有一人公司自动化方案。" }));
    expect(terms.map((item) => item.text)).toContain("一人公司自动化");
    expect(terms.map((item) => item.text)).not.toEqual(expect.arrayContaining(["AI tools", "Workflow automation"]));
  });

  it("does not mine English grammar fragments from GitHub descriptions", () => {
    const terms = extractSeedTerms(signal({
      sourceType: "github",
      title: "microsoft/mcp-launchpad",
      body: "This open-source curriculum introduces the fundamentals of Model Context Protocol through real-world examples.",
    }));
    expect(terms.map((item) => item.text)).toContain("mcp launchpad");
    expect(terms.map((item) => item.text)).not.toEqual(expect.arrayContaining(["of Model", "the agent", "Model"]));
    const readmeNoise = extractSeedTerms(signal({
      sourceType: "github",
      title: "jlcodes99/cockpit-tools",
      body: "<img src=\"docs/banner.png\"> Install `./run.sh` and query `/v1/models`. [APIKEY.FUN](https://example.com)",
    }));
    for (const term of ["docs/banner.png", "./run.sh", "/v1/models", "APIKEY.FUN"]) {
      expect(readmeNoise.map((item) => item.text)).not.toContain(term);
    }
  });

  it("does not turn a social post into Chinese sentence fragments", () => {
    const terms = extractSeedTerms(signal({
      sourceType: "manual",
      sourceName: "X web list",
      sourceUrl: "https://x.com/gregisenberg/status/1",
      body: "我认为冷邮件即将消亡。每个电子邮件收件箱很快都会有一个代理守门人，唯一通过的方法将是热介绍，或者足够有趣以至于代理决定你值得它主人花时间。",
    }));
    expect(terms.map((item) => item.text)).not.toEqual(expect.arrayContaining(["快都会有一个代理", "够有趣以至于代理"]));
    const workflowTerms = extractSeedTerms(signal({
      sourceType: "manual",
      sourceName: "X web list",
      sourceUrl: "https://x.com/levelsio/status/2",
      body: "它们一直都有很棒的 API，你只需要添加一个 API 令牌，就能完成几乎所有手动操作的事情。",
    }));
    expect(workflowTerms.map((item) => item.text)).not.toContain("需要添加一个 API 令牌");
  });

  it("keeps complete hyphenated model names from release announcements", () => {
    const terms = extractSeedTerms(signal({
      sourceType: "manual", sourceName: "X web list", sourceUrl: "https://x.com/abliteration_ai/status/1",
      title: "abliterated-model-large-v2", body: "今天我们发布了 abliterated-model-large-v2。",
    }));
    expect(terms.map((item) => item.text)).toContain("abliterated-model-large-v2");
    expect(terms.map((item) => item.text)).not.toContain("今天我们发布了 abliterated-model");
  });

  it("extracts a concrete English capability phrase from a manual social title", () => {
    const terms = extractSeedTerms(signal({
      sourceType: "manual", sourceName: "X web list", sourceUrl: "https://x.com/dannypostma/status/1",
      title: "digital twin seat availability", body: "一个真实体育场的数字孪生体显示每个座位的实际价格和可用性。",
    }));
    expect(terms.map((item) => item.text)).toContain("digital twin seat availability");
  });
});
