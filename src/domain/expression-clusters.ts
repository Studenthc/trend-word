import type { ExpressionCluster, RawSignal, SeedTerm } from "../types.js";
import { expressionKey, normalizeExpression } from "./normalize.js";

export function seedTermKey(text: string): string {
  const normalized = expressionKey(text);
  const tokens = normalized.split(/\s+/u).filter(Boolean);
  return /[a-z]/iu.test(normalized) ? [...tokens].sort().join(" ") : normalized;
}

export function clusterSeedTerms(seeds: SeedTerm[], signals: RawSignal[], now: string): ExpressionCluster[] {
  const groups: SeedTerm[][] = [];
  for (const seed of seeds) {
    const key = seedTermKey(seed.text);
    const group = groups.find((items) => seedTermKey(items[0]?.text ?? "") === key || sameProductEntity(items, seed));
    if (group) group.push(seed); else groups.push([seed]);
  }
  const signalById = new Map(signals.map((signal) => [signal.id, signal]));
  return groups.map((group) => {
    const sorted = [...group].sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.text.length - b.text.length);
    const relatedSignals = group.map((seed) => signalById.get(seed.rawSignalId)).filter((signal): signal is RawSignal => Boolean(signal));
    const timestamps = group.map((seed) => seed.firstSeenAt).sort();
    const firstSeenAt = timestamps[0] ?? now;
    const lastSeenAt = timestamps.at(-1) ?? firstSeenAt;
    const recent = group.filter((seed) => ageInDays(seed.firstSeenAt, now) <= 7);
    const sourceTypes = [...new Set(group.map((seed) => seed.sourceType))];
    return {
      id: `cluster-${seedTermKey(sorted[0]?.text ?? "unknown")}`,
      primaryTerm: sorted[0]?.text ?? "unknown",
      normalizedTerms: [...new Set(group.map((seed) => seed.normalizedText))],
      aliases: [...new Set(sorted.slice(1).map((seed) => seed.text))],
      kinds: [...new Set(group.map((seed) => seed.kind))],
      seedTermIds: group.map((seed) => seed.id), rawSignalIds: [...new Set(group.map((seed) => seed.rawSignalId))],
      sourceTypes, independentAuthors: new Set(relatedSignals.map((signal) => signal.author?.id ?? signal.author?.name).filter(Boolean)).size,
      independentCommunities: new Set(relatedSignals.map((signal) => signal.community).filter(Boolean)).size,
      firstSeenAt, lastSeenAt, freshness: recent.length > 1 && sourceTypes.length > 1 ? "rising" : ageInDays(lastSeenAt, now) <= 7 ? "new" : ageInDays(lastSeenAt, now) <= 30 ? "watch" : "stale",
    } satisfies ExpressionCluster;
  });
}

function sameProductEntity(items: SeedTerm[], seed: SeedTerm): boolean {
  if (seed.sourceType !== "producthunt" || items.some((item) => item.sourceType !== "producthunt")) return false;
  const first = items[0]?.text.trim().split(/\s+/u)[0]?.toLocaleLowerCase();
  const next = seed.text.trim().split(/\s+/u)[0]?.toLocaleLowerCase();
  return Boolean(first && next && first === next && first.length >= 3);
}

function ageInDays(value: string, now: string): number {
  const age = Date.parse(now) - Date.parse(value);
  return Number.isFinite(age) ? Math.max(0, age) / 86_400_000 : Number.POSITIVE_INFINITY;
}
