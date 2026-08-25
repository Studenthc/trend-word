export type ScysBrowserRow = { title: string; content: string };
export type ScysBrowserCard = { title: string; author: string; date: string };
export type ScysBrowserTransportRequest = { method: "content-search"; params?: Record<string, unknown> };
export type ScysBrowserTab = {
  playwright: {
    getByPlaceholder(text: string, options: { exact: boolean }): any;
    getByText(text: string, options: { exact: boolean }): any;
    waitForTimeout(timeoutMs: number): Promise<void>;
    evaluate<T>(fn: () => T): Promise<T>;
    locator(selector: string): any;
  };
};
export function normalizeScysBrowserItems(rows: Array<ScysBrowserRow & { body?: string; sourceUrl?: string }>, cards: ScysBrowserCard[], query: string, sourceUrl: string): Record<string, unknown>[];
export function extractScysSearchRows(input: { information?: Array<{ title?: string; content?: string }>; cards?: Array<{ title?: string; content?: string }>; backgroundCards?: unknown[] }): Array<{ title: string; content: string }>;
export function createScysBrowserTransport(tab: ScysBrowserTab, options?: { activityId?: number; sourceUrl?: string; waitMs?: number; detailWaitMs?: number; browser?: unknown }): (request: ScysBrowserTransportRequest) => Promise<unknown>;
