import type { Expression } from "../types.js";

export function deriveLifecycle(current: Expression, previous?: Expression): Expression["lifecycle"] {
  if (!previous) return "new";
  if (current.occurrences.length === 0 && current.lastSeenAt === previous.lastSeenAt) return "stable";
  if (current.occurrences.length === 0 && current.lastSeenAt !== previous.lastSeenAt) return "fading";
  if (current.occurrences.length > previous.occurrences.length) return "rising";
  if (current.occurrences.length === previous.occurrences.length) return previous.lifecycle === "new" ? "watch" : "stable";
  return "fading";
}
