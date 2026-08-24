import { classifySourceError } from "../health/source-health.js";

export type RetryOptions = {
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

const MAX_RETRIES = 1;
const MAX_DELAY_MS = 1_000;

export async function retryTransient<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const sleep = options.sleep ?? (async () => undefined);
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      const classified = classifySourceError(error);
      if (!classified.retryable || attempt >= MAX_RETRIES) throw error;
      attempt += 1;
      const delay = Math.max(0, Math.min(MAX_DELAY_MS, options.delayMs ?? 0));
      await sleep(delay);
    }
  }
}
