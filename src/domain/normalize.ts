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

const bilingualAliases: Array<[RegExp, string]> = [
  [/\bworkflow\b/giu, "工作流"],
  [/\bagent\b/giu, "代理"],
  [/\bmodel\b/giu, "模型"],
  [/\bgenerator\b/giu, "生成器"],
  [/\bautomation\b/giu, "自动化"],
];

export function expressionKey(text: string): string {
  let key = normalizeExpression(text).normalized;
  for (const [pattern, replacement] of bilingualAliases) key = key.replace(pattern, replacement);
  return key.replace(/\s+/gu, " ").trim();
}
