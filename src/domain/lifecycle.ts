import type { Expression } from "../types.js";

export type SourceCoverage = {
  status: "available" | "partial" | "failed";
  coverageAvailable?: boolean;
};

function instant(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function deriveLifecycle(current: Expression, previous?: Expression, coverage: SourceCoverage = { status: "available" }): Expression["lifecycle"] {
  if (!previous) return "new";
  const currentInstant = instant(current.lastSeenAt);
  const previousInstant = instant(previous.lastSeenAt);
  if (currentInstant === undefined || previousInstant === undefined) return previous.lifecycle;
  const coverageInsufficient = coverage.status === "failed" || (coverage.status === "partial" && coverage.coverageAvailable !== true);
  if (current.occurrences.length === 0 && coverageInsufficient) return previous.lifecycle;
  if (current.occurrences.length === 0 && currentInstant === previousInstant) return "stable";
  if (current.occurrences.length === 0 && currentInstant !== previousInstant) return "fading";
  if (current.occurrences.length > previous.occurrences.length) return "rising";
  if (current.occurrences.length === previous.occurrences.length) return previous.lifecycle === "new" ? "watch" : "stable";
  return "fading";
}
