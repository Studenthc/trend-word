import { parseRawSignal, parseSourceHealth, type RawSignal, type SourceAdapter, type SourceCollection, type SourceContext, type SourceType } from "../types.js";
import { classifySourceError, failureHealth, normalizeSourceHealth } from "../health/source-health.js";

export type { SourceAdapter, SourceCollection };

export type SourceCollector = (context: SourceContext) => Promise<SourceCollection>;

export type SafeSourceOptions = {
  context: SourceContext;
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

export async function runSafeSource(sourceType: SourceType, collect: SourceCollector, options: SafeSourceOptions): Promise<SourceCollection> {
  const attemptedAt = canonicalAttemptedAt(options.attemptedAt);
  const sleep = options.sleep ?? defaultSleep;
  let attempt = 0;

  while (attempt < 2) {
    attempt += 1;
    try {
      const result = await collect(options.context);
      const parsed = validateCollection(sourceType, result);
      const health = normalizeSourceHealth(sourceType, parsed.health, parsed.signals.length, attemptedAt);
      return { signals: parsed.signals, health };
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

function canonicalAttemptedAt(value: string | undefined): string {
  if (value) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return now();
}

function validateCollection(sourceType: SourceType, result: unknown): SourceCollection {
  if (!isRecord(result) || !("signals" in result) || !("health" in result)) {
    throw new Error("invalid source collection: missing signals or health");
  }
  if (!Array.isArray(result.signals)) throw new Error("invalid source collection: signals must be an array");
  let signals: RawSignal[];
  try {
    signals = result.signals.map(parseRawSignal);
  } catch (error) {
    throw new Error(`invalid raw signal: ${error instanceof Error ? error.message : String(error)}`);
  }
  let health;
  try {
    health = parseSourceHealth(result.health);
  } catch (error) {
    throw new Error(`invalid source health: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (health.sourceType !== sourceType) throw new Error(`sourceType mismatch: expected ${sourceType}, received ${health.sourceType}`);
  const mismatchedSignal = signals.find((signal) => signal.sourceType !== sourceType);
  if (mismatchedSignal) throw new Error(`signal sourceType mismatch: expected ${sourceType}, received ${mismatchedSignal.sourceType} for ${mismatchedSignal.id}`);
  if (health.itemCount !== signals.length) throw new Error(`invalid source health: itemCount ${health.itemCount} does not match signals ${signals.length}`);
  if (health.endpointCount !== undefined && health.successfulEndpointCount !== undefined && health.successfulEndpointCount > health.endpointCount) {
    throw new Error("invalid source health: successfulEndpointCount exceeds endpointCount");
  }
  return { signals, health };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
