import type { DiscoverySummary, Evidence, Expression, Opportunity, RawSignal, RunSummary, SourceHealth, SourceRole, SourceType } from "../types.js";
import type { CandidateQueue } from "../domain/candidates.js";

export type MarkdownReportInput = {
  summary: RunSummary;
  sourceHealth: SourceHealth[];
  signals: RawSignal[];
  expressions: Expression[];
  evidence: Evidence[];
  opportunities: Opportunity[];
  candidates?: CandidateQueue;
  discoverySummary?: DiscoverySummary;
  sourceRoles?: Partial<Record<SourceType, SourceRole>>;
};

const DAILY_REPORT_FORMAL_LIMIT = 10;

export function renderMarkdownReport(input: MarkdownReportInput): string {
  const lines = [`# 新词机会雷达 - ${input.summary.date}`, "", "> 工作流：发现源找刚出现的表达 → 手工查 Google Trends 过去 7 天 → SCYS 只验证中文需求与变现场景", ""];
  if (input.candidates) lines.push(...candidateSection(input.candidates));
  else lines.push("## 今天先查这 10 个词", "", "- 无（没有生成候选队列）");

  lines.push("", "## 来源状态", "");
  for (const source of input.sourceHealth) lines.push(...sourceStatusLines(source, input.discoverySummary, input.sourceRoles));

  if (input.discoverySummary?.demandExpressionCount !== undefined) {
    lines.push("", "## 需求抽取漏斗", "", `- 实体 ${input.discoverySummary.entityCount ?? 0} → 详情补全成功 ${input.discoverySummary.detailSucceeded ?? 0} → 需求表达 ${input.discoverySummary.demandExpressionCount}（原文/社媒 ${input.discoverySummary.directDemandCount ?? 0} / 能力推导 ${input.discoverySummary.capabilityDerivedCount ?? 0}）→ 正式验证池 ${input.discoverySummary.formalDemandCount ?? 0}`);
    if (input.discoverySummary.feedbackAttempted !== undefined && input.discoverySummary.feedbackAttempted > 0) lines.push(`- 反馈补全：已获取 ${input.discoverySummary.feedbackSucceeded ?? 0} 个反馈来源，不可用 ${input.discoverySummary.feedbackUnavailable ?? 0} 个`);
  }

  lines.push("", "## 今日提醒", "", ...reminderLines(input));
  lines.push("", "## 数据位置", "", ...dataLocationLines(input.summary));
  return `${lines.join("\n")}\n`;
}

function sourceStatusLines(source: SourceHealth, discovery?: DiscoverySummary, sourceRoles?: Partial<Record<SourceType, SourceRole>>): string[] {
  const quality = discovery?.sourceQuality.find((item) => item.sourceType === source.sourceType);
  const rawCount = quality?.rawCount ?? source.itemCount;
  const formalCount = quality?.formalCandidateCount ?? 0;
  const backupCount = quality?.backupCandidateCount ?? 0;
  const freshCount = quality?.freshCount ?? 0;
  const feedbackCount = quality?.feedbackCount;
  const role = sourceRoles?.[source.sourceType] ?? "discovery";
  const roleLabel = role === "validation" ? "验证" : "发现";
  const feedbackLabel = feedbackCount !== undefined ? ` | 反馈 ${feedbackCount}` : "";
  const lines = [`- ${source.sourceType}（${roleLabel}）: ${source.status} | 原始 ${rawCount} | 近7天 ${freshCount} | 验证池 ${formalCount} | 备选 ${backupCount}${feedbackLabel}`];
  for (const note of [...source.failureReasons, ...source.coverageNotes].slice(0, 2)) lines.push(`  - ${excerpt(note, 50)}`);
  return lines;
}

function reminderLines(input: MarkdownReportInput): string[] {
  const reminders: string[] = [];
  const verifications = [...(input.candidates?.formal ?? []), ...(input.candidates?.backup ?? [])].map((candidate) => candidate.trendVerification).filter((verification): verification is NonNullable<typeof verification> => Boolean(verification));
  if (verifications.length === 0) reminders.push("- Google Trends 尚未自动验证，候选链接使用过去 7 天窗口。");
  else reminders.push("- Google Trends 7d 已包含人工核验结果；指数是相对值，不能直接代表绝对搜索量。");
  if (verifications.some((verification) => verification.result === "no_data")) reminders.push("- Trends 显示暂无可见数据不等于没人搜；早期词建议 48–72 小时后复查原词、词根和同义表达。");
  const unavailable = input.sourceHealth.filter((source) => ["blocked", "partial", "unverified"].includes(source.status));
  if (unavailable.length > 0) reminders.push(`- 来源覆盖不完整：${unavailable.map((source) => source.sourceType).join("、")}。`);
  if (!input.candidates || input.candidates.formal.length === 0) reminders.push("- 今日没有满足正文和具体词门槛的候选。");
  return reminders;
}

function dataLocationLines(summary: RunSummary): string[] {
  const runDirectory = `data/runs/${summary.date}`;
  return [
    `- 原始发现池：${runDirectory}/raw-signals.jsonl`,
    `- 种子词：${runDirectory}/seed-terms.json`,
    `- 表达簇：${runDirectory}/expression-clusters.json`,
    `- 来源质量：${runDirectory}/discovery-summary.json`,
    `- 今日验证池：${runDirectory}/candidates.json`,
    `- 完整证据：${runDirectory}/evidence.json`,
  ];
}

function candidateSection(queue: CandidateQueue): string[] {
  const lines: string[] = ["## 今天先查这 10 个词", ""];
  if (queue.formal.length === 0) lines.push("- 无（当前没有满足用户需求或多来源佐证门槛的候选）");
  queue.formal.slice(0, DAILY_REPORT_FORMAL_LIMIT).forEach((candidate, index) => lines.push(...candidateLines(candidate, index + 1)));
  if (queue.backup.length > 0) {
    lines.push("", "## 观察候选", "");
    for (const candidate of queue.backup.slice(0, DAILY_REPORT_FORMAL_LIMIT)) lines.push(...backupCandidateLines(candidate));
  }
  return lines;
}

function candidateLines(candidate: CandidateQueue["formal"][number], index: number): string[] {
  const derived = candidate.evidenceOrigin === "capability_derived";
  const summarizedSocial = candidate.evidenceOrigin === "user_evidence" && candidate.evidencePrecision === "semantic";
  const missingFields = displayMissingFields(candidate);
  const trendStatus = trendStatusLabel(candidate);
  return [
    `### ${index}. ${candidate.term}`,
    `- 为什么现在：${candidate.whyNow?.join("；") ?? excerpt(candidate.reason, 100)}`,
    derived
      ? `- 类型：产品能力推导，${trendStatus}\n- 证据：${excerpt(candidate.evidenceQuote ?? candidate.context, 120)} · ${candidate.authorName ?? "未知作者"} · ${candidate.publishedAt?.slice(0, 10) ?? "未知日期"}`
      : candidate.evidenceOrigin === "user_evidence" && candidate.evidencePrecision === "exact"
        ? `- 类型：用户原话需求，${trendStatus}\n- 用户原话：${excerpt(candidate.evidenceQuote ?? candidate.context, 120)} · ${candidate.authorName ?? "未知作者"} · ${candidate.publishedAt?.slice(0, 10) ?? "未知日期"}`
      : summarizedSocial
        ? `- 类型：社媒观点归纳，${trendStatus}\n- 证据：${excerpt(candidate.evidenceQuote ?? candidate.context, 120)} · ${candidate.authorName ?? "未知作者"} · ${candidate.publishedAt?.slice(0, 10) ?? "未知日期"}`
      : `- 用户原话：${excerpt(candidate.evidenceQuote ?? candidate.context, 120)} · ${candidate.authorName ?? "未知作者"} · ${candidate.publishedAt?.slice(0, 10) ?? "未知日期"}`,
    trendVerificationLine(candidate),
    `- 来源：${candidate.sourceCount ? `${candidate.sourceCount} 个来源` : candidate.sourceType} · [原文](${candidate.sourceUrl}) · [查 Google Trends 7d](${candidate.trendsUrl})` + (missingFields.length > 0 ? ` · 尚缺：${missingFields.join("、")}` : ""),
  ];
}

function trendStatusLabel(candidate: CandidateQueue["formal"][number]): string {
  const result = candidate.trendVerification?.result;
  if (!result) return "待 Google Trends 验证";
  if (result === "no_data") return "Google Trends 暂无可见数据";
  const labels = { rising: "上升", breakout: "爆发", flat: "平稳", declining: "下降" } as const;
  return `Google Trends 已验证：${labels[result]}`;
}

function displayMissingFields(candidate: CandidateQueue["formal"][number]): string[] {
  return candidate.missingFields.map((field) => candidate.trendVerification?.result === "no_data" && field === "Google Trends 7d" ? "Trends 数据不足（不代表没人搜）" : field);
}

function trendVerificationLine(candidate: CandidateQueue["formal"][number]): string {
  const verification = candidate.trendVerification;
  if (!verification) return "- Trends 7d：未验证";
  const labels = { rising: "上升", breakout: "爆发", flat: "平稳", declining: "下降", no_data: "暂无可见数据（不代表没人搜）" } as const;
  const suffix = verification.result === "no_data" ? " · 建议 48–72 小时后复查原词、词根和同义表达" : "";
  return `- Trends 7d：${labels[verification.result]} · ${verification.region}${suffix}`;
}

function backupCandidateLines(candidate: CandidateQueue["backup"][number]): string[] {
  const missingFields = displayMissingFields(candidate);
  if (candidate.evidencePrecision === "inferred") {
    return [`- ${candidate.term} · 推测搜索词，仅观察，不进入今日验证池 · 证据：${excerpt(candidate.evidenceQuote ?? candidate.context, 120)} · 尚缺：${missingFields.join("、")} · [原文](${candidate.sourceUrl}) · [查 Google Trends 7d](${candidate.trendsUrl})`];
  }
  const evidenceLabel = candidate.evidenceOrigin === "capability_derived" ? "产品能力推导" : candidate.evidenceOrigin === "user_evidence" ? "用户原话需求" : "产品实体观察";
  return [`- ${candidate.term} · ${evidenceLabel} · ${candidate.qualificationReason ?? candidate.reason} · 尚缺：${missingFields.join("、")} · [原文](${candidate.sourceUrl})`];
}

function excerpt(value: string, limit = 240): string {
  const compact = value.replace(/[\u200B-\u200D\uFEFF]/gu, "").replace(/\s+/gu, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit).trimEnd()}…`;
}
