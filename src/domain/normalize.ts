const urlPattern = /(?:https?:\/\/|www\.)[^\s]+/giu;

export type NormalizedExpression = { original: string; normalized: string };

export function normalizeExpression(text: string): NormalizedExpression {
  const normalized = text
    .replace(urlPattern, " ")
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return { original: text, normalized };
}

export function expressionId(normalizedText: string): string | undefined {
  const normalized = normalizeExpression(normalizedText).normalized;
  return normalized ? `expression-${normalized}` : undefined;
}
