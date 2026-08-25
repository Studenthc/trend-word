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
    const searchOnce = async () => {
      await box.fill(query);
      const materials = tab.playwright.getByText("资料", { exact: true });
      if (await materials.count()) await materials.click();
      await tab.playwright.getByText("搜索", { exact: true }).last().click();
      // The first search after taking over a tab can hydrate the modal lazily;
      // keep a conservative default so stale results are not mistaken for a
      // valid zero-result query.
      await tab.playwright.waitForTimeout(options.waitMs ?? 1200);
      return tab.playwright.evaluate(() => [...document.querySelectorAll(".information")]
        .map((element) => ({
          title: (element.querySelector(".information-title")?.textContent || "").trim(),
          content: (element.querySelector(".information-content")?.textContent || "").trim(),
        }))
        .filter((item) => item.title));
    };
    // A newly claimed tab can return a partially hydrated first page. Repeat
    // the same read once and union by title; this also preserves true empty
    // results after the second request.
    let rows = await searchOnce();
    for (let attempt = 0; attempt < 2 && rows.length <= 1; attempt += 1) {
      rows = [...new Map([...rows, ...(await searchOnce())].map((item) => [item.title, item])).values()];
    }
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
