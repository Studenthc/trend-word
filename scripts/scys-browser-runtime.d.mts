export type ScysBrowserRow = { title: string; content: string };
export type ScysBrowserCard = { title: string; author: string; date: string };
export type ScysBrowserTransportRequest = { method: "content-search"; params?: Record<string, unknown> };
export type ScysBrowserTab = {
  playwright: {
    getByPlaceholder(text: string, options: { exact: boolean }): any;
    getByText(text: string, options: { exact: boolean }): any;
    waitForTimeout(timeoutMs: number): Promise<void>;
    evaluate<T>(fn: () => T): Promise<T>;
  };
};
export function normalizeScysBrowserItems(rows: ScysBrowserRow[], cards: ScysBrowserCard[], query: string, sourceUrl: string): Record<string, unknown>[];
export function createScysBrowserTransport(tab: ScysBrowserTab, options?: { activityId?: number; sourceUrl?: string; waitMs?: number }): (request: ScysBrowserTransportRequest) => Promise<unknown>;
