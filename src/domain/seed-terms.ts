import type { RawSignal, SeedTerm, SeedTermKind, SeedTermLocation } from "../types.js";
import { normalizeExpression } from "./normalize.js";

const noise = new Set(["ai", "工具", "新玩法", "风口", "需求", "出海", "赚钱", "创业", "短视频", "工作流"]);
const phraseMarkers = /(?:工具|小程序|生成器|修图|记账|翻译器|模板|generator|tool|app|game|workflow|model|skill)/iu;
const problemMarkers = /(?<!需)(?:求|需要|怎么|无法|打不开|保存不了|保存失败|尺寸不对|太贵|卡顿|失败|找不到)/u;

export function extractSeedTerms(signal: RawSignal): SeedTerm[] {
  if (signal.evidenceStatus === "failed") return [];
  const candidates: Array<{ text: string; location: SeedTermLocation; quote: string; reason: string }> = [];
  const fields: Array<[SeedTermLocation, string | undefined]> = [
    ["title", signal.title], ["excerpt", signal.excerpt], ["body", signal.body],
  ];
  for (const [location, value] of fields) {
    const text = value?.trim();
    if (!text) continue;
    for (const match of text.matchAll(/[「“‘"《`]([^」”’"》`]{2,40})[」”’"》`]/gu)) {
      const term = match[1]?.trim();
      if (term && (phraseMarkers.test(term) || /[A-Za-z]/u.test(term))) candidates.push({ text: term, location, quote: compactQuote(text, term), reason: "原文明确标记的新表达" });
    }
    for (const match of text.matchAll(/#([\p{L}\p{N}_-]{2,40})/gu)) {
      const term = match[1]?.trim();
      if (term) candidates.push({ text: term, location, quote: compactQuote(text, term), reason: "原文标签表达" });
    }
    if (location !== "title") {
      for (const sentence of splitSentences(text)) {
        if (problemMarkers.test(sentence)) {
          for (const term of problemTerms(sentence)) candidates.push({ text: term, location, quote: sentence, reason: "用户问题或失败反馈" });
        }
        for (const term of contextualTerms(sentence)) candidates.push({ text: term, location, quote: sentence, reason: "具体场景、工具或功能表达" });
      }
    }
  }
  if (signal.sourceType === "github" && signal.title) {
    const repo = signal.title.split("/").pop()?.replace(/[-_]+/gu, " ").trim();
    if (repo && !isDiscoveryNoise(repo) && !/(?:awesome|tutorial|course|beginner|toolkit|toolbox|collection|list)/iu.test(repo)) candidates.push({ text: repo, location: "metadata", quote: signal.title, reason: "GitHub 新仓库实体" });
  }
  if (signal.sourceType === "producthunt" && signal.title && !isDiscoveryNoise(signal.title)) {
    const productName = signal.title.split(/[:：|｜]/u)[0]?.trim() ?? signal.title;
    if (!isDiscoveryNoise(productName)) candidates.push({ text: productName, location: "metadata", quote: signal.title, reason: "Product Hunt 新产品实体" });
  }
  const seen = new Set<string>();
  return candidates.flatMap((candidate, index) => {
    const text = clean(candidate.text);
    const normalizedText = normalizeExpression(text).normalized;
    if (!text || isDiscoveryNoise(text) || text.length < 2 || text.length > 40 || !normalizedText) return [];
    const key = `${normalizedText}:${candidate.location}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const firstSeenAt = signal.publishedAt ?? signal.fetchedAt;
    return [{ id: `seed-${signal.id}-${index}`, rawSignalId: signal.id, text, normalizedText, kind: classifySeedTerm(text, candidate.quote), location: candidate.location, quote: compactQuote(candidate.quote, text), extractionReason: candidate.reason, firstSeenAt, sourceType: signal.sourceType } satisfies SeedTerm];
  });
}

export function classifySeedTerm(text: string, quote: string): SeedTermKind {
  if (/(?:问题|失败|无法|打不开|保存不了|尺寸不对|太贵|卡顿|找不到)/u.test(quote)) return "problem";
  if (/(?:generator|tool|app|小程序|工具|修图|记账|翻译器)/iu.test(text)) return "feature";
  if (/(?:game|游戏|玩法)/iu.test(text)) return "play";
  if (/(?:model|模型|skill|工程|engineering)/iu.test(text)) return "model";
  if (/^[A-Za-z][A-Za-z0-9 ._-]{1,39}$/u.test(text)) return "product";
  return "search_term";
}

export function isDiscoveryNoise(text: string): boolean {
  const normalized = normalizeExpression(text).normalized;
  return noise.has(normalized);
}

function contextualTerms(sentence: string): string[] {
  if (!/[\u3400-\u9FFF]/u.test(sentence)) return [];
  const matches = sentence.match(/[\p{L}\p{N}][\p{L}\p{N} +_-]{1,38}(?:工具|小程序|生成器|修图|记账|翻译器|模板|generator|tool|app|game|workflow|model|skill)/giu) ?? [];
  return matches.map((item) => item.trim()).filter((item) => !/^(?:a|an|the|for|with|new)\s/iu.test(item));
}

function problemTerms(sentence: string): string[] {
  const matches = sentence.match(/(?:打不开|保存不了|保存失败|尺寸不对|太贵|卡顿|找不到|无法[^，。！？]{0,16}|需要[^，。！？]{0,24}|(?<!需)求[^，。！？]{0,24})/gu) ?? [];
  return matches.map((item) => item.replace(/^(?:有没有|是否有|有没有人)/u, "").trim()).filter(Boolean);
}

function splitSentences(value: string): string[] { return value.split(/[。！？!?\n]/u).map((item) => item.trim()).filter(Boolean); }
function clean(value: string): string { return value.replace(/[「」“”‘’"《》`#]/gu, "").replace(/^(?:有没有|是否有|有没有人)/u, "").replace(/\s+/gu, " ").trim(); }
function compactQuote(value: string, term: string): string { const index = value.toLocaleLowerCase().indexOf(term.toLocaleLowerCase()); const start = Math.max(0, index - 60); return value.slice(start, start + 180).trim(); }
