import type { Expression, SourceHealthStatus } from "../types.js";

export type SourceCoverage = {
  status: SourceHealthStatus | "failed";
  coverageAvailable?: boolean;
};

export function canonicalTimestamp(value: string): string | undefined {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

export function deriveLifecycle(current: Expression, previous?: Expression, coverage: SourceCoverage = { status: "available" }): Expression["lifecycle"] {
  if (!previous) return "new";
  const currentCanonical = canonicalTimestamp(current.lastSeenAt);
  const previousCanonical = canonicalTimestamp(previous.lastSeenAt);
  const currentInstant = currentCanonical ? Date.parse(currentCanonical) : undefined;
  const previousInstant = previousCanonical ? Date.parse(previousCanonical) : undefined;
  if (currentInstant === undefined || previousInstant === undefined) return previous.lifecycle;
  const coverageInsufficient = coverage.status === "failed" || coverage.status === "blocked" || coverage.status === "empty" || coverage.status === "unverified" || (coverage.status === "partial" && coverage.coverageAvailable !== true);
  if (coverageInsufficient) return previous.lifecycle;
  if (current.occurrences.length === 0 && currentInstant === previousInstant) return "stable";
  if (current.occurrences.length === 0 && currentInstant !== previousInstant) return "fading";
  if (current.occurrences.length > previous.occurrences.length) return "rising";
  if (current.occurrences.length === previous.occurrences.length) return previous.lifecycle === "new" ? "watch" : "stable";
  return "fading";
}
