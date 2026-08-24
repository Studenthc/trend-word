import type { Expression, RawSignal } from "../types.js";
import { normalizeExpression } from "./normalize.js";
import { deriveLifecycle } from "./lifecycle.js";

function expressionText(signal: RawSignal): string {
  return signal.title ?? signal.excerpt ?? signal.body ?? signal.externalId ?? signal.id;
}

function keyFor(signal: RawSignal): string {
  const normalized = normalizeExpression(expressionText(signal)).normalized;
  return normalized;
}

export function dedupeRawSignals(signals: RawSignal[]): RawSignal[] {
  const seen = new Set<string>();
  const result: RawSignal[] = [];
  for (const signal of signals) {
    const keys = [keyFor(signal), signal.sourceUrl, signal.externalId].filter((value): value is string => Boolean(value));
    const duplicate = keys.some((key) => seen.has(key));
    keys.forEach((key) => seen.add(key));
    if (!duplicate) result.push(signal);
  }
  return result;
}

export function mergeExpressions(signals: RawSignal[], previous: Expression[]): Expression[] {
  const groups = new Map<string, RawSignal[]>();
  for (const signal of signals) {
    const normalized = normalizeExpression(expressionText(signal)).normalized;
    const group = groups.get(normalized) ?? [];
    group.push(signal);
    groups.set(normalized, group);
  }

  return [...groups.entries()].map(([normalizedText, group]) => {
    const first = group[0]!;
    const previousExpression = previous.find((item) => item.normalizedText === normalizedText);
    const authors = new Set(group.map((item) => item.author?.id ?? item.author?.name).filter((value): value is string => Boolean(value)));
    const communities = new Set(group.map((item) => item.community).filter((value): value is string => Boolean(value)));
    const publishers = new Set(group.map((item) => item.sourceName));
    const occurrences = group.map((item) => ({ rawSignalId: item.id, sourceType: item.sourceType, seenAt: item.fetchedAt }));
    const firstSeenAt = previousExpression?.firstSeenAt ?? first.publishedAt ?? first.fetchedAt.slice(0, 10);
    const lastSeenAt = group.map((item) => item.publishedAt ?? item.fetchedAt.slice(0, 10)).sort().at(-1) ?? firstSeenAt;
    const current: Expression = {
      id: previousExpression?.id ?? `expression-${normalizedText}`,
      text: expressionText(first), normalizedText, aliases: [...new Set(group.map((item) => expressionText(item)))].filter((item) => item !== expressionText(first)),
      kind: previousExpression?.kind ?? "concept", firstSeenAt, lastSeenAt, occurrences,
      sourceFamilies: [...new Set(group.map((item) => item.sourceType))], independentAuthors: authors.size,
      independentCommunities: communities.size, independentPublishers: publishers.size,
      lifecycle: "new",
      trendState: previousExpression?.trendState ?? "unknown", qualification: previousExpression?.qualification ?? "discovered", rejectionReasons: previousExpression?.rejectionReasons ?? [],
    };
    current.lifecycle = deriveLifecycle(current, previousExpression);
    return current;
  });
}
