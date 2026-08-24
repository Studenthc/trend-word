import { expressionId } from "../domain/normalize.js";
import { trendSnapshotSchema, type TrendSnapshot } from "../types.js";

export type ManualTrendsSnapshotInput = {
  expression?: string;
  expressionId?: string;
  capturedAt: string;
  window: TrendSnapshot["window"];
  region?: string;
  value?: number;
  delta?: number;
  relatedQueries?: TrendSnapshot["relatedQueries"];
  status?: TrendSnapshot["status"];
  notes?: string;
};

export type GoogleTrendsOptions = { mode?: "manual-or-optional"; provider?: never };

const windowMilliseconds: Record<TrendSnapshot["window"], number> = {
  "4h": 4 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "12m": 365 * 24 * 60 * 60 * 1000,
  "5y": 5 * 365 * 24 * 60 * 60 * 1000,
};

export function parseManualTrendsSnapshot(input: ManualTrendsSnapshotInput): TrendSnapshot {
  const id = input.expressionId ?? (input.expression ? expressionId(input.expression) : undefined);
  if (!id) throw new Error("Google Trends snapshot requires expression or expressionId");
  return trendSnapshotSchema.parse({
    expressionId: id, provider: "google_trends", capturedAt: input.capturedAt, window: input.window,
    ...(input.region ? { region: input.region } : {}), ...(typeof input.value === "number" ? { value: input.value } : {}),
    ...(typeof input.delta === "number" ? { delta: input.delta } : {}), relatedQueries: input.relatedQueries ?? [], status: input.status ?? "unavailable", ...(input.notes ? { notes: input.notes } : {}),
  });
}

export function isFreshTrendSnapshot(snapshot: TrendSnapshot, referenceAt = new Date().toISOString()): boolean {
  const captured = Date.parse(snapshot.capturedAt);
  const reference = Date.parse(referenceAt);
  if (Number.isNaN(captured) || Number.isNaN(reference)) return false;
  const age = reference - captured;
  return age >= 0 && age <= windowMilliseconds[snapshot.window];
}

export async function resolveGoogleTrends(input: ManualTrendsSnapshotInput, _options: GoogleTrendsOptions = {}): Promise<TrendSnapshot> {
  const snapshot = parseManualTrendsSnapshot({ ...input, status: "unavailable" });
  return { ...snapshot, value: undefined, delta: undefined, status: "unavailable" };
}
