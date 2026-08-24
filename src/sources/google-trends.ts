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

export function parseManualTrendsSnapshot(input: ManualTrendsSnapshotInput): TrendSnapshot {
  const id = input.expressionId ?? (input.expression ? expressionId(input.expression) : undefined);
  if (!id) throw new Error("Google Trends snapshot requires expression or expressionId");
  return trendSnapshotSchema.parse({
    expressionId: id, provider: "google_trends", capturedAt: input.capturedAt, window: input.window,
    ...(input.region ? { region: input.region } : {}), ...(typeof input.value === "number" ? { value: input.value } : {}),
    ...(typeof input.delta === "number" ? { delta: input.delta } : {}), relatedQueries: input.relatedQueries ?? [], status: input.status ?? "verified", ...(input.notes ? { notes: input.notes } : {}),
  });
}

export async function resolveGoogleTrends(input: ManualTrendsSnapshotInput, _options: GoogleTrendsOptions = {}): Promise<TrendSnapshot> {
  const snapshot = parseManualTrendsSnapshot({ ...input, status: "unavailable" });
  return { ...snapshot, value: undefined, delta: undefined, status: "unavailable" };
}
