/**
 * Runtime-only SCYS browser bridge.
 *
 * The caller supplies a claimed, already-authenticated tab. This module never
 * reads cookies, storage, tokens, or browser profile files.
 */
export function normalizeScysBrowserItems(rows, cards, query, sourceUrl) {
  return rows.map((row, index) => {
    const card = cards.find((candidate) => candidate.title === row.title);
    const body = row.body || row.content || row.title;
    const verified = Boolean(row.body && row.sourceUrl);
    return {
      id: `live-${query}-${index}`,
      title: row.title,
      body,
      ...(body !== row.title ? { excerpt: body } : {}),
      author: { name: card?.author || "未知" },
      ...(card?.date ? { publishedAt: toIsoDate(card.date) } : {}),
      url: row.sourceUrl || sourceUrl,
      tags: [query],
      ...(verified ? {} : { syncWarnings: ["SCYS browser search result captured; full detail body not fetched"] }),
      evidenceStatus: verified ? "verified" : "partial",
    };
  });
}

export function extractScysSearchRows({ information = [], cards = [] }) {
  const visibleInformation = information.filter((item) => item?.title);
  if (visibleInformation.length > 0) return visibleInformation;
  return cards.filter((item) => item?.title);
}

export function createScysBrowserTransport(tab, options = {}) {
  const activityId = options.activityId ?? 10095;
  const sourceUrl = options.sourceUrl ?? `https://scys.com/activity/documents?id=${activityId}&index=1`;
  return async (request) => {
    if (request.method !== "content-search") throw new Error(`unsupported SCYS browser method: ${request.method}`);
    const query = String(request.params?.query ?? "");
    const searchOnce = async () => {
      const box = await ensureSearchBox(tab, options.waitMs ?? 1200);
      await box.fill(query);
      const materials = tab.playwright.getByText("资料", { exact: true });
      if (await materials.count()) await materials.click();
      const searchButton = tab.playwright.getByText("搜索", { exact: true });
      if (await searchButton.count()) await searchButton.last().click();
      else if (typeof box.press === "function") await box.press("Enter");
      else {
        const pageSearchIcon = tab.playwright.locator(".document-head .search .icon");
        if (await pageSearchIcon.count()) await pageSearchIcon.click();
      }
      // The first search after taking over a tab can hydrate the modal lazily;
      // keep a conservative default so stale results are not mistaken for a
      // valid zero-result query.
      await tab.playwright.waitForTimeout(options.waitMs ?? 1200);
      return tab.playwright.evaluate(() => {
        const modal = [...document.querySelectorAll(".modal")]
          .find((element) => element.querySelector('input[placeholder="请输入关键词"]'));
        const information = [...(modal?.querySelectorAll(".information") ?? [])]
          .map((element) => ({
            title: (element.querySelector(".information-title")?.textContent || "").trim(),
            content: (element.querySelector(".information-content")?.textContent || "").trim(),
          }))
          .filter((item) => item.title);
        const cards = [...(modal?.querySelectorAll(".col") ?? [])]
          .map((element) => ({ title: (element.querySelector(".topShare")?.textContent || "").trim(), content: "" }))
          .filter((item) => item.title);
        if (information.length > 0) return information;
        return cards;
      });
    };
    // A newly claimed tab can return a partially hydrated first page. Repeat
    // the same read once and union by title; this also preserves true empty
    // results after the second request.
    let rows = await runSearchWithRetry(searchOnce, tab, options.waitMs ?? 1200);
    for (let attempt = 0; attempt < 2 && rows.length <= 1; attempt += 1) {
      rows = [...new Map([...rows, ...(await runSearchWithRetry(searchOnce, tab, options.waitMs ?? 1200))].map((item) => [item.title, item])).values()];
    }
    const cards = await tab.playwright.evaluate(() => [...document.querySelectorAll(".col")]
      .map((element) => ({
        title: (element.querySelector(".topShare")?.textContent || "").trim(),
        author: (element.querySelector(".midShare")?.textContent || "").trim(),
        date: (element.querySelector(".share-data")?.textContent || "").replace("分享日期：", "").trim(),
      }))
      .filter((item) => item.title));
    // Search results are often sorted by relevance. Re-sort the visible
    // records by their published card date so the daily run favors fresh
    // discovery signals; targeted keyword searches still retain their best
    // matches when a date is unavailable.
    rows = [...rows]
      .sort((left, right) => cardDateScore(right, cards) - cardDateScore(left, cards))
      .slice(0, options.maxSourcesPerQuery ?? 3);
    if (!options.browser) return { items: normalizeScysBrowserItems(rows, cards, query, sourceUrl) };

    const detailedRows = [];
    for (const row of rows) {
      try {
        const before = await options.browser.user.openTabs();
        await clickVisibleResult(tab, row.title);
        const detailInfo = await waitForDetailTab(options.browser, before, sourceUrl, row.title, options.detailWaitMs ?? 2500);
        if (!detailInfo) {
          detailedRows.push(row);
          continue;
        }
        const detailTab = await options.browser.user.claimTab(detailInfo);
        await detailTab.playwright.waitForTimeout(options.detailWaitMs ?? 250);
        const detail = await detailTab.playwright.evaluate(() => ({
          body: [...document.querySelectorAll(".zone-container.minutes-editable")]
            .map((element) => (element.textContent || "").trim())
            .filter(Boolean)
            .join("\n"),
        }));
        detailedRows.push({ ...row, body: detail.body, sourceUrl: detailInfo.url });
      } catch {
        detailedRows.push(row);
      }
    }
    return { items: normalizeScysBrowserItems(detailedRows, cards, query, sourceUrl) };
  };
}

function cardDateScore(row, cards) {
  const card = cards.find((item) => item.title === row.title);
  const parsed = card?.date ? Date.parse(`${card.date}T00:00:00+08:00`) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

async function clickVisibleResult(tab, title) {
  try {
    const information = tab.playwright.locator(".information").filter({ hasText: title }).first();
    await information.click();
    return;
  } catch (error) {
    const card = tab.playwright.locator(".col").filter({ hasText: title }).first();
    try {
      await card.click();
    } catch {
      throw error;
    }
  }
}

async function ensureSearchBox(tab, waitMs) {
  const modalBox = tab.playwright.getByPlaceholder("请输入关键词", { exact: true });
  if (await modalBox.count()) return modalBox;
  const opener = tab.playwright.locator(".document-head .search .icon");
  if (await opener.count()) {
    await opener.click();
    await tab.playwright.waitForTimeout(Math.min(waitMs, 500));
  }
  if (await modalBox.count()) return modalBox;
  const pageBox = tab.playwright.getByPlaceholder("请输入搜索内容", { exact: true });
  if (await pageBox.count()) return pageBox;
  throw new Error("SCYS search input unavailable after opening visible document search");
}

async function runSearchWithRetry(searchOnce, tab, waitMs) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await searchOnce();
    } catch (error) {
      lastError = error;
      if (attempt === 0) await tab.playwright.waitForTimeout(Math.min(waitMs, 500));
    }
  }
  throw lastError;
}

async function waitForDetailTab(browser, before, sourceUrl, expectedTitle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const tabs = await browser.user.openTabs();
    const candidate = tabs
      .filter((tab) => tab.url && tab.url !== sourceUrl)
      .filter((tab) => {
        const previous = before.find((item) => item.id === tab.id);
        return !previous || previous.url !== tab.url || previous.title !== tab.title;
      })
      .sort((left, right) => detailTabScore(right, expectedTitle) - detailTabScore(left, expectedTitle))[0];
    if (candidate) return candidate;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return undefined;
}

function detailTabScore(tab, expectedTitle) {
  const url = tab.url || "";
  const title = tab.title || "";
  return (url.includes("/t/") ? 8 : 0) + (url.includes("feishu.cn/minutes/") ? 6 : 0) + (title.includes(expectedTitle) ? 4 : 0);
}

function toIsoDate(date) {
  const parsed = new Date(`${date}T00:00:00+08:00`);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}
