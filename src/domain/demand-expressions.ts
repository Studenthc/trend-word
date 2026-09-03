import type { DemandExpression, RawSignal } from "../types.js";
import { normalizeExpression } from "./normalize.js";

type DemandType = DemandExpression["type"];
type DemandAssessment = Pick<DemandExpression, "qualityState" | "qualityScore"> & { failureReason?: string };
type EvidencePrecision = NonNullable<DemandExpression["evidencePrecision"]>;
type ExtractedDemand = { text: string; type: DemandType; quote: string; origin: DemandExpression["origin"]; transformation: string; evidencePrecision: EvidencePrecision };

const MAX_EXPRESSIONS = 3;

export function extractDemandExpressions(signal: RawSignal): DemandExpression[] {
  if (signal.evidenceStatus === "failed") return [];
  if (signal.sourceType === "model-catalog") return [];
  const rawBody = [signal.body, signal.excerpt].find((value) => value?.trim())?.trim();
  const body = rawBody ? sanitizeMarkdown(rawBody) : undefined;
  if (!body) return [];
  if (isCuratedRepository(signal)) return [];
  const candidates: ExtractedDemand[] = [];
  const allowCapabilityDerivation = !isCuratedRepository(signal);
  if (["manual", "x-timeline", "reddit-feed"].includes(signal.sourceType)) {
    candidates.push(...extractSocialDemands(body));
    candidates.push(...extractSocialCapabilityDemands(body));
  }
  for (const quote of splitSentences(body)) {
    addMatch(candidates, quote, /\b(?:to|for|and)\s+(automate|manage|create|generate|organize|translate)\s+([^.!?]{3,80}?)(?=\s+(?:and|but|for|to)\b|$)/iu, "task", (match) => `${match[1] ?? ""} ${match[2] ?? ""}`);
    addMatch(candidates, quote, /\b(?:automating|managing|creating|generating|organizing|translating)\s+([^.!?]{3,80})$/iu, "task", (match) => match[0] ?? "");
    addMatch(candidates, quote, /\b(?:replace|alternative to)\s+([A-Za-z][A-Za-z0-9_-]{1,40})(?=\s+(?:and|but|with|to)\b|$)/iu, "alternative", (match) => `replace ${match[1]}`);
    addMatch(candidates, quote, /\b(?:users?|teams?|makers?)\s+(?:need|want)\s+(?:(?:a|an|the)\b\s+)?([^.!?]{3,80})/iu, "pain", (match) => match[1] ?? "");
    addMatch(candidates, quote, /\basks?\s+for\s+(?:a|an|the)\s+([^.!?]{3,80}?)(?=\s+instead of\b|$)/iu, "pain", (match) => match[1] ?? "");
    addMatch(candidates, quote, /\b(?:self-hosted|open-source)\s+([^.!?]{3,70}?\b(?:automation|workflow|tool|app|generator|platform))\b/iu, "task", (match) => `${match[0]}`);
    const capability = allowCapabilityDerivation && !hasUserEvidence(quote) ? deriveCapabilityQuery(quote) : undefined;
    if (capability) candidates.push({ text: capability.text, type: "task", quote, origin: "capability_derived", transformation: capability.transformation, evidencePrecision: "semantic" });
  }
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    if (!allowCapabilityDerivation && candidate.type === "task" && !hasUserEvidence(candidate.quote)) return [];
    if (allowCapabilityDerivation && candidate.type === "task" && ["producthunt", "github"].includes(signal.sourceType) && !hasUserEvidence(candidate.quote)) {
      const capability = deriveCapabilityQuery(candidate.quote);
      if (!capability && (isOperationalSentence(candidate.quote) || isActionPhrase(candidate.text))) return [];
      return [capability ? { ...candidate, text: capability.text, origin: "capability_derived" as const, transformation: capability.transformation, evidencePrecision: "semantic" as const } : { ...candidate, origin: "capability_derived" as const, transformation: "保留产品能力表达，等待趋势验证", evidencePrecision: "semantic" as const }];
    }
    return [candidate];
  }).flatMap((candidate, index) => {
    const text = clean(candidate.text);
    const normalizedText = normalizeExpression(text).normalized;
    if (!text || text.length < 2 || text.length > 80 || seen.has(normalizedText) || isGeneric(text)) return [];
    seen.add(normalizedText);
    const expression: DemandExpression = {
      id: `demand-${signal.id}-${index}`, text, normalizedText, type: candidate.type, rawSignalId: signal.id,
      sourceEntityId: `entity-${signal.sourceType}-${signal.externalId ?? signal.id}`, sourceType: signal.sourceType, sourceUrl: signal.sourceUrl,
      evidenceQuote: candidate.quote.slice(0, 500), evidenceLocation: signal.body?.trim() ? "body" : "excerpt", evidenceGrade: "direct",
      qualityState: "review", qualityScore: 0, origin: candidate.origin, sourceText: (rawBody ?? body).slice(0, 2000), transformation: candidate.transformation, evidencePrecision: candidate.evidencePrecision, firstSeenAt: signal.publishedAt ?? signal.fetchedAt,
    };
    const assessment = assessDemandExpression(expression, body);
    return [{ ...expression, ...assessment }];
  }).slice(0, MAX_EXPRESSIONS);
}

export function assessDemandExpression(expression: DemandExpression, sourceText = expression.evidenceQuote): DemandAssessment {
  if (!expression.evidenceQuote.trim()) return { qualityState: "rejected", qualityScore: 0, failureReason: "evidence_missing" };
  if (isGeneric(expression.text)) return { qualityState: "rejected", qualityScore: 20, failureReason: "expression_too_generic" };
  if (["producthunt", "github"].includes(expression.sourceType) && expression.type === "task" && !/(?:\b(?:users?|teams?|makers?)\s+(?:need|want|ask|asked|report|reported|say|said)\b|\b(?:replace|alternative to|issue|problem|bug)\b)/iu.test(sourceText)) return { qualityState: "review", qualityScore: 55 };
  if (expression.origin === "capability_derived") return { qualityState: "review", qualityScore: 55 };
  if (expression.type === "pain" || expression.type === "alternative") return { qualityState: "verified", qualityScore: 90 };
  return { qualityState: "verified", qualityScore: 80 };
}

function addMatch(target: ExtractedDemand[], quote: string, pattern: RegExp, type: DemandType, format: (match: RegExpMatchArray) => string): void {
  const match = quote.match(pattern);
  if (match) target.push({ text: format(match), type, quote, origin: "user_evidence", transformation: "保留原文需求表达", evidencePrecision: "exact" });
}

function extractSocialDemands(body: string): ExtractedDemand[] {
  const candidates: ExtractedDemand[] = [];
  const codexVoiceQuote = body.match(/Codex voice[\s\S]{0,600}(?:hard to use|constantly switch threads|multitasks only sometimes|inconsistently)[\s\S]{0,80}/iu)?.[0];
  if (codexVoiceQuote) {
    candidates.push(
      { text: "Codex voice thread switching", type: "pain", quote: codexVoiceQuote, origin: "user_evidence", transformation: "将 Codex voice 反复切换工作线程的具体反馈压缩为可搜索痛点短语", evidencePrecision: "semantic" },
      { text: "Codex voice multitasking", type: "pain", quote: codexVoiceQuote, origin: "user_evidence", transformation: "将 Codex voice 只能偶尔多任务的具体反馈压缩为可搜索痛点短语", evidencePrecision: "semantic" },
      { text: "Codex voice context access", type: "pain", quote: codexVoiceQuote, origin: "user_evidence", transformation: "将 Codex voice 访问其余 Codex 内容不一致的具体反馈压缩为可搜索痛点短语", evidencePrecision: "semantic" },
    );
  }
  for (const quote of splitSentences(body)) {
    if (/(?:电子邮件|邮箱|冷邮件|邮件)[^.!?。！？]{0,80}(?:代理守门人|收件箱[^.!?。！？]{0,30}代理)/u.test(quote)) {
      candidates.push({ text: "AI email gatekeeper", type: "task", quote, origin: "user_evidence", transformation: "将社媒中的邮箱代理筛选观点归纳为可搜索的英文名词短语", evidencePrecision: "semantic" });
    }
    if (/(?:热介绍|足够有趣)[^.!?。！？]{0,60}(?:代理|主人)/u.test(quote)) {
      candidates.push({ text: "agent-readable email", type: "task", quote, origin: "user_evidence", transformation: "将代理决定邮件是否值得人工阅读的完整观点归纳为可搜索短语", evidencePrecision: "inferred" });
    }
    if (/(?:AI\s*)?(?:生成|批量生成)邮件/u.test(quote) && /(?:不正常|反感|讨厌|拒绝|垃圾)/u.test(quote)) {
      candidates.push({ text: "AI-proof outreach", type: "alternative", quote, origin: "user_evidence", transformation: "将对 AI 批量邮件的明确负面反馈归纳为反自动化触达需求词", evidencePrecision: "inferred" });
    }
    if (/Claude\s+Code[^.!?。！？]{0,40}注册域名|注册域名[^.!?。！？]{0,40}Claude\s+Code/iu.test(quote)) {
      candidates.push({ text: "AI domain registration", type: "task", quote, origin: "user_evidence", transformation: "将 Claude Code 执行域名注册的完整工作流归纳为可搜索任务短语", evidencePrecision: "semantic" });
    }
    if (/(?:Cloudflare|API)/iu.test(quote) && /(?:手动操作|服务器|API 令牌|API token)/iu.test(quote)) {
      candidates.push({ text: "AI infrastructure automation", type: "task", quote, origin: "user_evidence", transformation: "将 API 代替服务器手动操作的完整场景归纳为基础设施自动化短语", evidencePrecision: "semantic" });
    }
  }
  return candidates;
}

function extractSocialCapabilityDemands(body: string): ExtractedDemand[] {
  const candidates: ExtractedDemand[] = [];
  const add = (text: string, type: DemandType, pattern: RegExp, transformation: string): void => {
    const match = body.match(pattern);
    if (match) candidates.push({ text, type, quote: match[0], origin: "capability_derived", transformation, evidencePrecision: "semantic" });
  };
  add("one-tweet shader generator", "task", /online editor for One tweet shader[^.]*generator[^.]*/iu, "将 X 中的 shader 编辑和 GIF/WebM 生成能力压缩为可搜索任务短语");
  add("AI copyright guardrails", "task", /系统提示[^。！？]{0,100}(?:歌曲歌词|受版权保护的角色)/u, "将模型系统提示中的版权限制归纳为可搜索的 AI 能力短语");
  add("remove.bg alternative", "alternative", /(?:淘汰|替代)\s*remove\.?bg[^。！？]{0,80}/iu, "将从 remove.bg 迁移并自建替代品的产品信号归纳为可搜索替代词");
  add("AI vulnerability detection", "task", /漏洞检测[^。！？]{0,40}/u, "将 Gemini Cyber 的漏洞发现能力压缩为可搜索任务短语");
  add("AI vulnerability patching", "task", /自动化修补[^。！？]{0,40}/u, "将 Gemini Cyber 的自动修补能力压缩为可搜索任务短语");
  add("AI code review signal-to-noise", "task", /代码审查[\s\S]{0,180}信噪比/u, "将 AI 代码审查降噪和训练控制能力压缩为可搜索任务短语");
  add("enterprise AI inference platform", "task", /企业构建 AI[\s\S]{0,180}(?:开放模型平台|全球数据中心)/u, "将企业开放模型部署平台能力归纳为可搜索任务短语");
  add("AI agent skill security scanner", "task", /运行 AI 代理技能之前扫描其安全风险/u, "将运行代理技能前的安全扫描能力压缩为可搜索工具短语");
  add("background computer use", "task", /后台使用你的电脑[\s\S]{0,160}(?:点击|输入|打开应用)/u, "将代理后台点击、输入和打开应用的能力压缩为可搜索任务短语");
  add("local inference engine", "task", /开源[^。！？]{0,80}本地推理引擎/u, "将设备端混合计算中的本地推理引擎能力保留为可搜索短语");
  add("GLM 5.3 free trial", "task", /免费试用[^。！？]{0,80}(?:GLM\s*5\.3|无需 API 设置)/iu, "将无需 API 配置即可试用模型的入口归纳为可搜索任务短语");
  add("AI spec-to-code workflow", "task", /用于制定规格和计划[^。！？]{0,60}用于实现/u, "将用不同模型分工制定规格、计划和实现的工作流压缩为可搜索短语");
  return candidates;
}

function splitSentences(value: string): string[] { return value.split(/[.!?。！？\n]/u).map((item) => item.trim()).filter(Boolean); }
function clean(value: string): string { return value.replace(/["“”‘’「」]/gu, "").replace(/\s+/gu, " ").trim().replace(/[.,;:]+$/u, ""); }
function isGeneric(value: string): boolean { return /^(?:ai|ai tools?|automation|tool|platform|app|custom tool|practical workflow|open-source web app)$/iu.test(value.trim()); }
function sanitizeMarkdown(value: string): string {
  return value.replace(/```[\s\S]*?```/gu, " ").replace(/<!--[\s\S]*?-->/gu, " ").replace(/!?(?:\[([^\]]+)\])\([^)]*\)/gu, "$1").replace(/^\s{0,3}#{1,6}\s+.*$/gmu, "").replace(/^\s*[-*_]{3,}\s*$/gmu, "").replace(/`{1,3}/gu, "").replace(/^\s{0,3}(?:[-*+] |>+)\s*/gmu, "").replace(/\s*\|\s*/gu, " ").replace(/<[^>]+>/gu, "").replace(/[ \t]+/gu, " ").replace(/\n+/gu, ". ").replace(/\.\s*\./gu, ". ").trim();
}

function deriveCapabilityQuery(sentence: string): { text: string; transformation: string } | undefined {
  const photo = sentence.match(/\bgenerate\s+((?:AI\s+)?(?:photos?|images?|videos?))\b/iu);
  if (photo) return { text: `${singularize(photo[1] ?? "")} generator`, transformation: "将 generate + photo/image/video 改写为可搜索的 generator 名词短语" };
  const customStyle = sentence.match(/\bgenerate\s+(?:your\s+own\s+)?([^.!?]+?styles?)\b/iu);
  if (customStyle?.[1]) return { text: `${singularize(cleanObject(customStyle[1]))} generator`, transformation: "去掉 generate 和时间修饰，改写为 generator 名词短语" };
  const notation = sentence.match(/\bcreat(?:e|ing)\s+(?:a\s+)?([A-Za-z][A-Za-z -]{2,60}?\s+notation)\b/iu);
  if (notation?.[1]) return { text: notation[1].trim(), transformation: "去掉 create 动词，保留具体 notation 对象作为搜索词" };
  const creation = sentence.match(/\b(?:creat(?:e|ing)|generat(?:e|ing))\s+(?:(?:a|an|the|your|own)\s+)?([^.!?]+?)(?=\s+(?:from|using|for\s+free|with|and|to)\b|,\s*(?:\d|in\b)|$)/iu);
  if (creation?.[1]) {
    const object = cleanObject(creation[1]);
    if (isOperationalSentence(object) || !isSearchableCapabilityObject(object)) return undefined;
    if (/(?:images?|photos?|videos?|articles?)$/iu.test(object)) return { text: `${singularize(object)} generator`, transformation: "去掉 create/generate 动词和尾部修饰，改写为 generator 名词短语" };
    if (object.length >= 5) return { text: singularize(object), transformation: "去掉 create/generate 动词及尾部来源修饰，保留具体对象" };
  }
  const automation = sentence.match(/\b(?:automating|automate)\s+(?:the\s+)?([^.!?]+?)(?:\s+at\s+scale)?$/iu);
  if (automation?.[1]) {
    const object = cleanObject(automation[1] ?? "");
    if (/(?:install|package|account|login|sign in|download|setup|set up)/iu.test(object) || !isSearchableCapabilityObject(object)) return undefined;
    if (object.length >= 5) return { text: `${singularize(object)} automation`, transformation: "去掉 automate 动词和执行修饰，改写为对象 automation 名词短语" };
  }
  const management = sentence.match(/\bmanaging\s+(?:and\s+interacting\s+with\s+)?([^.!?]+?)(?:\s+using\b|$)/iu);
  if (management?.[1]) {
    const object = cleanObject(management[1]);
    if (object.length >= 5 && !isOperationalSentence(object) && isSearchableCapabilityObject(object)) return { text: `${object} management`, transformation: "去掉 managing 动词，改写为对象 management 名词短语" };
  }
  const building = sentence.match(/\bfor\s+building\s+([^.!?]+?)(?=\s*(?:[,;]|\b(?:from|using|and|with)\b|$))/iu);
  if (building?.[1]) {
    const object = cleanObject(building[1]);
    if (object.length >= 5 && !isOperationalSentence(object) && isSearchableCapabilityObject(object) && !/^(?:modular|scalable|secure|production-ready)$/iu.test(object)) return { text: `${singularize(object)} builder`, transformation: "去掉 building 动词，改写为对象 builder 名词短语" };
  }
  return undefined;
}

function hasUserEvidence(sentence: string): boolean {
  return /(?:\b(?:users?|teams?|makers?)\s+(?:need|want|ask|asked|report|reported|say|said)\b|\b(?:replace|alternative to|issue|problem|bug)\b)/iu.test(sentence);
}

function isCuratedRepository(signal: RawSignal): boolean {
  const identity = `${signal.title ?? ""} ${signal.externalId ?? ""}`;
  return /(?:awesome|toolkit|top[- ]ai[- ]tools|collection|catalog|resources)/iu.test(identity);
}

function isOperationalSentence(sentence: string): boolean { return /\b(?:install|installation|package|account|login|sign in|download|setup|set up)\b/iu.test(sentence); }
function isActionPhrase(value: string): boolean { return /^(?:automate|automating|create|creating|generate|generating|manage|managing|organize|organizing|translate|translating)\b/iu.test(value.trim()); }

function cleanObject(value: string): string { return value.replace(/^\s*(?:and|or|but)\s+(?:deploy(?:ing)?|edit(?:ing)?|shape|lead|manage|train|construct|face)\s+/iu, "").replace(/\b(?:your|own|a|an|the|in minutes|in seconds|in one click|with one click|at scale|production-ready)\b/giu, "").replace(/\band interacting with\b/giu, "").replace(/[,;:]+/gu, " ").replace(/\s+/gu, " ").trim(); }
function singularize(value: string): string { return value.replace(/\b(?:tasks|workflows|systems|tools|videos|applications|agents)\b/iu, (word) => ({ tasks: "task", workflows: "workflow", systems: "system", tools: "tool", videos: "video", applications: "application", agents: "agent" }[word.toLocaleLowerCase()] ?? word)).replace(/\bphotos\b/iu, "photo").replace(/\bimages\b/iu, "image").replace(/\bstyles\b/iu, "style").replace(/\barticles\b/iu, "article").trim(); }

function isSearchableCapabilityObject(value: string): boolean {
  if (/(?:fictional\s+belief|oracle\s+products?|performance\s+simulations?)/iu.test(value)) return false;
  if (/[\u3400-\u9FFF]/u.test(value)) return false;
  if (/^(?:lightweight|simple|easy|powerful|modern|generic|practical)\s+(?:tools?|apps?|platforms?)$/iu.test(value)) return false;
  return /(?:\bAI\b|photo|image|video|article|style|notation|workflow|task|tool|application|system|agent|subtitle|translation|invoice|domain|SEO|slide)/iu.test(value);
}
