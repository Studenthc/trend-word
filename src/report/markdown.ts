import type { DiscoverySummary, Evidence, Expression, KeywordModelMapping, ModelCapability, ModelCombination, ModelRecord, Opportunity, RawSignal, RunSummary, SourceHealth, SourceRole, SourceType } from "../types.js";
import type { CandidateQueue } from "../domain/candidates.js";
import { isBaselineModelQuery, modelCapabilitySummary, modelQueryPriority } from "../domain/model-capabilities.js";

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
  xWebScan?: XWebScanSummary;
  modelRadar?: ModelRadarReport;
};

export type XWebScanSummary = {
  scannedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  rejectionReasons?: Record<string, number>;
};

export type ModelRadarReport = {
  models: ModelRecord[];
  capabilities: ModelCapability[];
  mappings: KeywordModelMapping[];
  combinations: ModelCombination[];
};

const DAILY_REPORT_FORMAL_LIMIT = 10;

export function renderMarkdownReport(input: MarkdownReportInput): string {
  const lines = [`# 新词机会雷达 - ${input.summary.date}`, "", "> 工作流：发现源找刚出现的表达 → 手工查 Google Trends 过去 7 天 → SCYS 只验证中文需求与变现场景", ""];
  if (input.candidates) lines.push(...candidateSection(input.candidates));
  else lines.push("## 今天先查这 10 个词", "", "- 无（没有生成候选队列）");

  lines.push("", "## 来源状态", "");
  for (const source of input.sourceHealth) lines.push(...sourceStatusLines(source, input.discoverySummary, input.sourceRoles));
  if (input.modelRadar) lines.push("", ...modelRadarLines(input.modelRadar, input.sourceHealth));
  if (input.xWebScan) {
    lines.push("", "## X 手工扫描", "", `- 扫描 ${input.xWebScan.scannedCount} | 入选 ${input.xWebScan.acceptedCount} | 过滤 ${input.xWebScan.rejectedCount}`);
  }

  if (input.discoverySummary?.demandExpressionCount !== undefined) {
    lines.push("", "## 需求抽取漏斗", "", `- 实体 ${input.discoverySummary.entityCount ?? 0} → 详情补全成功 ${input.discoverySummary.detailSucceeded ?? 0} → 需求表达 ${input.discoverySummary.demandExpressionCount}（原文/社媒 ${input.discoverySummary.directDemandCount ?? 0} / 能力推导 ${input.discoverySummary.capabilityDerivedCount ?? 0}）→ 正式验证池 ${input.discoverySummary.formalDemandCount ?? 0}`);
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
  const role = sourceRoles?.[source.sourceType] ?? "discovery";
  const roleLabel = role === "validation" ? "验证" : "发现";
  const lines = [`- ${source.sourceType}（${roleLabel}）: ${source.status} | 原始 ${rawCount} | 近7天 ${freshCount} | 验证池 ${formalCount} | 备选 ${backupCount}`];
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
    `- 模型库存：${runDirectory}/model-inventory.json`,
    `- 能力归一化：${runDirectory}/capabilities.json`,
    `- 需求词映射：${runDirectory}/keyword-model-mapping.json`,
    `- 组合假设：${runDirectory}/model-combinations.json`,
  ];
}

function modelRadarLines(modelRadar: ModelRadarReport, sourceHealth: SourceHealth[]): string[] {
  const counts = new Map<ModelRecord["platform"], number>();
  for (const model of modelRadar.models) counts.set(model.platform, (counts.get(model.platform) ?? 0) + 1);
  const modelHealth = sourceHealth.find((source) => source.sourceType === "model-catalog");
  const coverageNotes = modelHealth?.coverageNotes ?? [];
  const unknownWhenUnavailable = modelHealth !== undefined && modelHealth.status !== "available";
  const huggingFaceCount = unknownWhenUnavailable && (counts.get("huggingface") ?? 0) === 0 ? "未核验" : `${counts.get("huggingface") ?? 0} 条`;
  const falUnavailable = unknownWhenUnavailable && (counts.get("fal-ai") ?? 0) === 0;
  const falCount = falUnavailable ? "未核验" : `${counts.get("fal-ai") ?? 0} 条`;
  const actionableMappings = modelRadar.mappings.filter((mapping) => !isBaselineModelQuery(mapping.normalizedKeyword)).sort((left, right) => modelQueryPriority(right.keyword) - modelQueryPriority(left.keyword) || left.keyword.localeCompare(right.keyword, "en-US"));
  const baselineMappingCount = modelRadar.mappings.length - actionableMappings.length;
  const lines = ["## 模型能力雷达", "", `- 模型目录：Hugging Face ${huggingFaceCount} · fal.ai ${falCount}；归一化能力 ${modelRadar.capabilities.length} 条；待查能力 ${actionableMappings.length} 条${baselineMappingCount > 0 ? `；常规能力略过 ${baselineMappingCount} 条` : ""}；组合假设 ${modelRadar.combinations.length} 条`];
  for (const note of coverageNotes) {
    if (/(?:huggingface|fal-ai):\s+(?:available|partial|blocked|empty|unverified)/iu.test(note)) lines.push(`- 覆盖：${note.replace(/^fal-ai:/u, "fal.ai:")}`);
  }
  for (const mapping of actionableMappings.slice(0, 5)) {
    const url = mapping.sourceUrls[0];
    const capability = mapping.capabilityId.replace(/^capability-/u, "");
    lines.push(`- 产品能力推导：${mapping.keyword} · ${modelCapabilitySummary(capability)} · 待 Google Trends 验证${url ? ` · [模型原文](${url})` : ""}`);
  }
  const modelById = new Map(modelRadar.models.map((model) => [model.id, model]));
  for (const combination of modelRadar.combinations.slice(0, 3)) {
    const model = combination.candidateModels.map((id) => modelById.get(id) ?? modelRadar.models.find((item) => item.id.endsWith(`:${id}`))).find((item): item is ModelRecord => Boolean(item));
    lines.push(`- 组合假设：${combination.combinedQuery} · ${combination.capabilityChain.join(" -> ")} · 待 Google Trends 验证${model ? ` · [模型原文](${model.modelUrl})` : ""}`);
  }
  return lines;
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
  const modelDerived = derived && candidate.sourceType === "model-catalog";
  const summarizedSocial = candidate.evidenceOrigin === "user_evidence" && candidate.evidencePrecision === "semantic";
  const missingFields = displayMissingFields(candidate);
  const trendStatus = trendStatusLabel(candidate);
  return [
    `### ${index}. ${candidate.term}`,
    `- 为什么现在：${candidate.whyNow?.join("；") ?? excerpt(candidate.reason, 100)}`,
    derived
      ? modelDerived
        ? `- 类型：产品能力推导，${trendStatus}\n- 能力依据：${excerpt(candidate.evidenceQuote ?? candidate.context, 120)}`
        : `- 类型：产品能力推导，${trendStatus}\n- 证据：${excerpt(candidate.evidenceQuote ?? candidate.context, 120)} · ${candidate.authorName ?? "未知作者"} · ${candidate.publishedAt?.slice(0, 10) ?? "未知日期"}`
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
  return [`- ${candidate.term} · ${candidate.qualificationReason ?? candidate.reason} · 尚缺：${missingFields.join("、")} · [原文](${candidate.sourceUrl})`];
}

function excerpt(value: string, limit = 240): string {
  const compact = value.replace(/[\u200B-\u200D\uFEFF]/gu, "").replace(/\s+/gu, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit).trimEnd()}…`;
}
