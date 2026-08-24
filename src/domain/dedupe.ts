import type { Expression, RawSignal } from "../types.js";
import { expressionId, normalizeExpression } from "./normalize.js";
import { deriveLifecycle } from "./lifecycle.js";

function expressionText(signal: RawSignal): string {
  const text = [signal.title, signal.excerpt, signal.body].find((value) => value?.trim());
  return text?.trim() || signal.externalId?.trim() || `raw-signal-${signal.id}`;
}

function rawIdentityKeys(signal: RawSignal): string[] {
  const source = signal.sourceType;
  const keys = [`fingerprint:${source}:${signal.sourceFingerprint}:${signal.sourceUrl}:${signal.externalId ?? ""}`];
  if (signal.sourceUrl) keys.push(`url:${source}:${signal.sourceUrl}`);
  if (signal.externalId) keys.push(`external:${source}:${signal.externalId}`);
  return keys;
}

export function dedupeRawSignals(signals: RawSignal[]): RawSignal[] {
  const seen = new Set<string>();
  const result: RawSignal[] = [];
  for (const signal of signals) {
    const keys = rawIdentityKeys(signal);
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
    const repostClusters = new Map<string, RawSignal>();
    for (const item of group) {
      const cluster = item.sourceFingerprint || item.id;
      if (!repostClusters.has(cluster)) repostClusters.set(cluster, item);
    }
    const representatives = [...repostClusters.values()];
    const authors = new Set(representatives.map((item) => item.author?.id ?? item.author?.name).filter((value): value is string => Boolean(value)));
    const communities = new Set(representatives.map((item) => item.community).filter((value): value is string => Boolean(value)));
    const publishers = new Set(representatives.map((item) => item.sourceName));
    const occurrences = group.map((item) => ({ rawSignalId: item.id, sourceType: item.sourceType, seenAt: item.fetchedAt }));
    const firstSeenAt = previousExpression?.firstSeenAt ?? first.publishedAt ?? first.fetchedAt.slice(0, 10);
    const lastSeenAt = group.map((item) => item.publishedAt ?? item.fetchedAt.slice(0, 10)).sort().at(-1) ?? firstSeenAt;
    const current: Expression = {
      id: previousExpression?.id ?? expressionId(normalizedText) ?? `expression-${first.id}`,
      text: expressionText(first), normalizedText, aliases: [...new Set(group.map((item) => expressionText(item)))].filter((item) => item !== expressionText(first)),
      kind: previousExpression?.kind ?? "concept", firstSeenAt, lastSeenAt, occurrences,
      sourceFamilies: [...new Set(representatives.map((item) => item.sourceType))], independentAuthors: authors.size,
      independentCommunities: communities.size, independentPublishers: publishers.size,
      lifecycle: "new",
      trendState: previousExpression?.trendState ?? "unknown", qualification: previousExpression?.qualification ?? "discovered", rejectionReasons: previousExpression?.rejectionReasons ?? [],
    };
    current.lifecycle = deriveLifecycle(current, previousExpression);
    return current;
  });
}
