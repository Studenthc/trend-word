import type { RawSignal, SourceAdapter, SourceCollection, SourceContext, SourceType } from "../types.js";
import { classifySourceError, failureHealth, normalizeSourceHealth } from "../health/source-health.js";

export type { SourceAdapter, SourceCollection };

export type SourceCollector = (context?: SourceContext) => Promise<SourceCollection>;

export type SafeSourceOptions = {
  context?: SourceContext;
  retryDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  attemptedAt?: string;
};

const MAX_RETRY_DELAY_MS = 1_000;

function now(): string {
  return new Date().toISOString();
}

function boundedDelay(delayMs: number | undefined): number {
  if (!Number.isFinite(delayMs)) return 0;
  return Math.max(0, Math.min(MAX_RETRY_DELAY_MS, delayMs ?? 0));
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function runSafeSource(sourceType: SourceType, collect: SourceCollector, options: SafeSourceOptions = {}): Promise<SourceCollection> {
  const attemptedAt = options.attemptedAt ?? now();
  const sleep = options.sleep ?? defaultSleep;
  let attempt = 0;

  while (attempt < 2) {
    attempt += 1;
    try {
      const result = await collect(options.context);
      const health = normalizeSourceHealth(sourceType, result.health, result.signals.length, result.health.attemptedAt || attemptedAt);
      return { signals: result.signals, health };
    } catch (error) {
      const classified = classifySourceError(error);
      if (classified.retryable && attempt === 1) {
        await sleep(boundedDelay(options.retryDelayMs));
        continue;
      }
      return { signals: [] as RawSignal[], health: failureHealth(sourceType, classified, attemptedAt) };
    }
  }

  throw new Error("unreachable bounded source retry");
}
