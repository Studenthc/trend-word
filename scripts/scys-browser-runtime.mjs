/**
 * Runtime-only SCYS browser bridge.
 *
 * The caller supplies a claimed, already-authenticated tab. This module never
 * reads cookies, storage, tokens, or browser profile files.
 */
export function normalizeScysBrowserItems(rows, cards, query, sourceUrl) {
  return rows.map((row, index) => {
    const card = cards.find((candidate) => candidate.title === row.title);
    return {
      id: `live-${query}-${index}`,
      title: row.title,
      body: row.content || row.title,
      ...(row.content ? { excerpt: row.content } : {}),
      author: { name: card?.author || "未知" },
      ...(card?.date ? { publishedAt: toIsoDate(card.date) } : {}),
      url: sourceUrl,
      tags: [query],
      syncWarnings: ["SCYS browser search result captured; full detail body not fetched"],
      evidenceStatus: "partial",
    };
  });
}

export function createScysBrowserTransport(tab, options = {}) {
  const activityId = options.activityId ?? 10095;
  const sourceUrl = options.sourceUrl ?? `https://scys.com/activity/documents?id=${activityId}&index=1`;
  return async (request) => {
    if (request.method !== "content-search") throw new Error(`unsupported SCYS browser method: ${request.method}`);
    const query = String(request.params?.query ?? "");
    const box = tab.playwright.getByPlaceholder("请输入关键词", { exact: true });
    await box.fill(query);
    const materials = tab.playwright.getByText("资料", { exact: true });
    if (await materials.count()) await materials.click();
    await tab.playwright.getByText("搜索", { exact: true }).last().click();
    await tab.playwright.waitForTimeout(options.waitMs ?? 700);
    const rows = await tab.playwright.evaluate(() => [...document.querySelectorAll(".information")]
      .map((element) => ({
        title: (element.querySelector(".information-title")?.textContent || "").trim(),
        content: (element.querySelector(".information-content")?.textContent || "").trim(),
      }))
      .filter((item) => item.title));
    const cards = await tab.playwright.evaluate(() => [...document.querySelectorAll(".col")]
      .map((element) => ({
        title: (element.querySelector(".topShare")?.textContent || "").trim(),
        author: (element.querySelector(".midShare")?.textContent || "").trim(),
        date: (element.querySelector(".share-data")?.textContent || "").replace("分享日期：", "").trim(),
      }))
      .filter((item) => item.title));
    return { items: normalizeScysBrowserItems(rows, cards, query, sourceUrl) };
  };
}

function toIsoDate(date) {
  const parsed = new Date(`${date}T00:00:00+08:00`);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}
