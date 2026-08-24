import type { Expression, RawSignal } from "../types.js";
import { expressionId, normalizeExpression } from "./normalize.js";
import { canonicalTimestamp, deriveLifecycle, type SourceCoverage } from "./lifecycle.js";

function expressionText(signal: RawSignal): string | undefined {
  const text = [signal.title, signal.excerpt, signal.body].find((value) => value?.trim());
  return text?.trim();
}

function rawIdentityKeys(signal: RawSignal): string[] {
  const source = signal.sourceType;
  const keys: string[] = [];
  const fingerprint = signal.sourceFingerprint.trim();
  const sourceUrl = signal.sourceUrl.trim();
  const externalId = signal.externalId?.trim();
  if (fingerprint && (sourceUrl || externalId)) keys.push(`fingerprint:${source}:${fingerprint}:${sourceUrl}:${externalId ?? ""}`);
  if (sourceUrl) keys.push(`url:${source}:${sourceUrl}`);
  if (externalId) keys.push(`external:${source}:${externalId}`);
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

export function mergeExpressions(signals: RawSignal[], previous: Expression[], coverage: SourceCoverage): Expression[] {
  const groups = new Map<string, RawSignal[]>();
  for (const signal of signals.filter((item) => item.evidenceStatus !== "failed")) {
    const text = expressionText(signal);
    if (!text) continue;
    const normalized = normalizeExpression(text).normalized;
    if (!normalized) continue;
    const group = groups.get(normalized) ?? [];
    group.push(signal);
    groups.set(normalized, group);
  }

  for (const item of previous) {
    if (!groups.has(item.normalizedText)) groups.set(item.normalizedText, []);
  }

  const observationTimestamp = signals
    .filter((item) => item.evidenceStatus !== "failed")
    .flatMap((item) => [item.publishedAt, item.fetchedAt])
    .map((value) => value ? canonicalTimestamp(value) : undefined)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return [...groups.entries()].map(([normalizedText, group]) => {
    const first = group[0];
    const previousExpression = previous.find((item) => item.normalizedText === normalizedText);
    const repostClusters = new Map<string, RawSignal>();
    for (const item of group) {
      const cluster = item.sourceFingerprint || item.id;
      if (!repostClusters.has(cluster)) repostClusters.set(cluster, item);
    }
    const representatives = [...repostClusters.values()];
    const authors = new Set(representatives.map((item) => item.author?.id ? `id:${item.sourceType}:${item.author.id}` : item.author?.name ? `name:${item.sourceType}:${item.author.name.trim().toLocaleLowerCase("en-US")}` : undefined).filter((value): value is string => Boolean(value)));
    const communities = new Set(representatives.map((item) => item.community ? normalizeExpression(item.community).normalized : undefined).filter((value): value is string => Boolean(value)));
    const publishers = new Set(representatives.map((item) => item.sourceType));
    const occurrences = group.map((item) => ({ rawSignalId: item.id, sourceType: item.sourceType, seenAt: canonicalTimestamp(item.fetchedAt) ?? (item.publishedAt ? canonicalTimestamp(item.publishedAt) : undefined) ?? "unknown" }));
    const timestamps = group.flatMap((item) => [item.publishedAt, item.fetchedAt]).map((value) => value ? canonicalTimestamp(value) : undefined).filter((value): value is string => Boolean(value)).sort();
    const firstSeenAt = canonicalTimestamp(previousExpression?.firstSeenAt ?? "") ?? timestamps[0] ?? "";
    const lastSeenAt = timestamps.at(-1) ?? canonicalTimestamp(previousExpression?.lastSeenAt ?? "") ?? "";
    const firstText = (first && expressionText(first)) ?? previousExpression?.text ?? "Unknown expression";
    const aliases = new Set([
      ...(previousExpression?.aliases ?? []),
      ...(previousExpression?.text ? [previousExpression.text] : []),
      ...group.map(expressionText).filter((value): value is string => Boolean(value)),
    ]);
    aliases.delete(firstText);
    const sourceFamilies = representatives.length > 0 ? [...new Set(representatives.map((item) => item.sourceType))] : previousExpression?.sourceFamilies ?? [];
    const independentAuthors = representatives.length > 0 ? authors.size : previousExpression?.independentAuthors ?? 0;
    const independentCommunities = representatives.length > 0 ? communities.size : previousExpression?.independentCommunities ?? 0;
    const independentPublishers = representatives.length > 0 ? publishers.size : previousExpression?.independentPublishers ?? 0;
    const current: Expression = {
      id: expressionId(normalizedText) ?? `expression-${first?.id ?? previousExpression?.id ?? "unknown"}`,
      text: firstText, normalizedText, aliases: [...aliases],
      kind: previousExpression?.kind ?? "concept", firstSeenAt, lastSeenAt, occurrences,
      sourceFamilies, independentAuthors,
      independentCommunities, independentPublishers,
      lifecycle: "new",
      trendState: previousExpression?.trendState ?? "unknown", qualification: previousExpression?.qualification ?? "discovered", rejectionReasons: previousExpression?.rejectionReasons ?? [],
    };
    current.lifecycle = deriveLifecycle(current, previousExpression, coverage, group.length === 0 ? observationTimestamp : undefined);
    return current;
  });
}
