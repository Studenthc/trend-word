# 新词机会雷达产品规格

日期：2026-08-24  
工作区：`/Users/huchenhao/code/website/github/trend-word-2`

## 1. 目标

构建一个本地优先的新词与新需求机会雷达。它从生财 MCP、搜索建议、趋势数据、风向标、公开社区和竞品页面中发现新表达，并把每个机会整理为可追溯的证据链，回答：

1. 这个表达或需求是什么；
2. 为什么现在值得关注；
3. 谁正在需要或使用它；
4. 现有供给是否充分；
5. 是否值得做成工具、内容、服务、目录或其他产品。

产品输出是“机会判断”，不是未经验证的热词清单。

## 2. 研究结论与产品原则

### 2.1 新词的定义

新词不只指新 SEO 关键词，还包括：

- 新搜索表达和用户下拉词；
- 新产品、模型、平台和功能名称；
- 新的场景概念和行业说法；
- 用户反复使用的新问题表达；
- 新平台玩法和早期商业机会。

### 2.2 机会判断链

```text
发现表达/信号
  -> 判断是否新鲜或上升
  -> 识别真实意图和用户群
  -> 验证跨来源问题或采用
  -> 检查 SERP 与现有供给
  -> 检查交付能力与变现证据
  -> 输出可行动机会或明确驳回原因
```

### 2.3 证据原则

- 原始来源优先于 AI 总结；
- 每个结论必须能回指 URL、作者、时间和原文片段；
- 同一内容的转载不能算多个独立来源；
- 流量估算、个人收入截图和社区传闻必须标注证据等级；
- “有人搜索”不等于“有人付费”；
- “词很新”不等于“适合现在做”；
- 发现阶段允许低置信度，行动建议必须经过验证门槛。

## 3. 用户工作流

### 3.1 每日雷达

用户运行一次本地命令，系统执行：

1. 拉取配置范围内的新内容和历史新增信号；
2. 保存不可变的原始信号；
3. 抽取表达、实体、问题和事件；
4. 与历史记录去重并计算生命周期；
5. 对优先候选执行趋势、意图、竞争和商业验证；
6. 生成 Markdown 报告及机器可读 JSON。

### 3.2 人工复核工作流

用户可以从报告进入某个机会，查看：

- 原始来源和证据片段；
- 相关表达、别名和反例；
- 趋势快照；
- 用户问题及出现频次；
- 竞品页面和 SERP 观察；
- 商业证据与风险；
- 尚缺少的验证项。

用户可以将机会标记为：继续验证、暂缓、驳回、已执行。系统不自动发布、不自动购买域名、不自动发送消息。

## 4. 系统边界

### 4.1 MVP 包含

- 版本化的数据模型；
- JSON/JSONL 本地存储；
- 原始信号保存与来源指纹；
- 表达规范化、别名合并和历史生命周期；
- 证据链校验；
- 生财 MCP 适配接口；
- 下拉词和人工导入适配接口；
- 生财 MCP、Product Hunt 发布流和 GitHub 新仓库作为稳定主干来源；
- X 已知账号时间线和 Reddit 配置社区 RSS 作为条件社媒来源；
- 来源健康状态、可用性降级和覆盖边界报告；
- 机会状态机；
- Markdown/JSON 报告；
- 确定性的规则验证和测试夹具。

### 4.2 MVP 不包含

- 浏览器爬取生财页面；
- 读取、保存或转发 Cookie、MCP 密钥；
- 自动点赞、投锚、收藏、发帖或私信；
- 完整 Web Dashboard；
- 自动生成网站或部署页面；
- 付费关键词工具硬依赖；
- X 全局搜索和 Reddit 全局搜索硬依赖；
- 用模型幻觉补全缺失证据。

## 5. 数据模型

### 5.1 RawSignal

`RawSignal` 是一次来源采集的不可变记录，不允许被聚合结果覆盖。

```ts
type RawSignal = {
  id: string;
  sourceType: SourceType;
  sourceName: string;
  sourceUrl: string;
  externalId?: string;
  title?: string;
  body?: string;
  excerpt?: string;
  author?: AuthorRef;
  community?: string;
  publishedAt?: string;
  fetchedAt: string;
  language?: string;
  sourceTier: "first_party" | "community" | "market" | "search";
  engagement?: Engagement;
  sourceFingerprint: string;
  evidenceStatus: "verified" | "partial" | "failed";
  failureReason?: string;
};
```

### 5.2 Expression

`Expression` 表示原文中出现的词、短语或用户问题，不等同于最终机会。

```ts
type Expression = {
  id: string;
  text: string;
  normalizedText: string;
  aliases: string[];
  kind: "search_term" | "product" | "model" | "feature" | "concept" | "problem" | "play";
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: Occurrence[];
  sourceFamilies: string[];
  independentAuthors: number;
  independentCommunities: number;
  independentPublishers: number;
  lifecycle: "new" | "watch" | "rising" | "stable" | "fading" | "mature";
  trendState: "unknown" | "rising" | "flat" | "declining" | "volatile";
  qualification: "discovered" | "corroborating" | "qualified" | "rejected";
  rejectionReasons: string[];
};
```

### 5.3 Evidence

`Evidence` 是对某个判断的最小可审计证据。

```ts
type Evidence = {
  id: string;
  subjectId: string;
  claimType:
    | "newness"
    | "trend"
    | "user_problem"
    | "adoption"
    | "search_intent"
    | "serp_competition"
    | "monetization"
    | "delivery"
    | "risk";
  rawSignalId: string;
  quote: string;
  location: "title" | "body" | "comment" | "query" | "url" | "metadata";
  capturedAt: string;
  evidenceGrade: "direct" | "reported" | "estimated" | "inferred";
  independentFrom?: string[];
  notes?: string;
};
```

### 5.4 TrendSnapshot

趋势数据必须保留采集时间、时间窗口、地区和数据口径。

```ts
type TrendSnapshot = {
  expressionId: string;
  provider: "google_trends" | "suggest" | "manual";
  capturedAt: string;
  window: "4h" | "24h" | "7d" | "30d" | "12m" | "5y";
  region?: string;
  value?: number;
  delta?: number;
  relatedQueries: Array<{ text: string; growth?: number; type?: "top" | "rising" }>;
  status: "verified" | "unavailable" | "partial";
  notes?: string;
};
```

### 5.5 Opportunity

`Opportunity` 是面向用户的聚合对象。

```ts
type Opportunity = {
  id: string;
  primaryExpressionId: string;
  title: string;
  summary: string;
  audiences: string[];
  userProblems: string[];
  recommendedArtifact: "tool" | "content" | "service" | "directory" | "plugin" | "observe" | "none";
  evidenceIds: string[];
  validation: ValidationState;
  riskFlags: RiskFlag[];
  status: "new" | "watch" | "validating" | "actionable" | "paused" | "rejected" | "executed";
  createdAt: string;
  updatedAt: string;
};
```

### 5.6 ValidationState

验证状态采用门槛，不用一个黑盒总分替代判断。

```ts
type ValidationState = {
  freshness: "unknown" | "confirmed" | "stale";
  trend: "unknown" | "rising" | "stable" | "declining" | "event_spike";
  intent: "unknown" | "informational" | "tool" | "commercial" | "service";
  demand: "unknown" | "single_signal" | "repeated" | "cross_source";
  competition: "unknown" | "thin" | "mixed" | "strong";
  monetization: "unknown" | "reported" | "observed" | "verified";
  delivery: "unknown" | "possible" | "quick_mvp" | "blocked";
  confidence: "low" | "medium" | "high";
  missingChecks: string[];
};
```

## 6. 来源适配器

所有适配器输出 `RawSignal`，不能直接写 `Opportunity`。

### 6.0 首批来源分层

首版来源按“能否稳定产生可审计数据”分层，而不是按理论信息价值排序：

| 层级 | 来源 | 首版职责 | 缺失时的行为 |
| --- | --- | --- | --- |
| 稳定主干 | 生财 MCP | 中文项目、精华、风向标、新玩法和案例 | 主流程可继续，但报告标记生财覆盖缺失 |
| 稳定主干 | Product Hunt 发布流 | 新产品、命名、功能和产品描述 | 不阻塞运行 |
| 稳定主干 | GitHub Trending / 新仓库 | 新工具、模型、README 表达和 issue 需求 | 不阻塞运行，记录 API 限流 |
| 条件接入 | X 已知账号时间线 | 已配置账号的早期传播信号 | 只报告可用账号，不推断全局 X 没有新词 |
| 条件接入 | Reddit 配置社区 RSS/页面 | 社区问题、吐槽和替代需求 | 429、403、空结果分别报告 |
| 人工补充 | 用户粘贴 URL、文本或导出记录 | 补齐不可访问来源的关键证据 | 标记为人工来源，不伪装成自动采集 |

首版不把 X 全局搜索或 Reddit 全局搜索作为主流程依赖。来源不可用时，系统仍须用稳定主干产出报告，并明确说明覆盖范围变窄。

### 6.1 生财 MCP

优先使用官方 MCP 作为生财内容入口，覆盖：

- `contentSearch` / `searchTopic`：帖子、精华、风向标；
- `topicDetail`：正文、评论和互动数据；
- `projectLibSearch` / `projectLibDetail`：项目库；
- `activityManualSearch`：航海手册；
- `searchVisibleActivityQa` / `searchVisibleActivitySubmissions`：航海问题和作业；
- 用户公开资料和评论能力，仅在明确配置时启用。

MCP 适配器必须：

- 使用用户本地配置的官方客户端或安全运行时；
- 不把密钥写入仓库、报告或原始信号；
- 默认只读；
- 遵守约每分钟 40 次调用限制，批量任务串行或限并发；
- 保留权限、同步延迟和失败状态；
- 对“没有结果”与“调用失败”分别建模。

### 6.2 Search Suggest

输入配置词根，采集字母、数字、常见修饰词和语言变体的下拉建议。采集结果与历史比较，新增项进入 `Expression`，但不能仅凭一次出现进入 `actionable`。

### 6.3 Google Trends

第一阶段只设计接口和本地夹具，不把真实 API 绑定写死。适配器需要支持 4h/24h/7d/30d/12m/5y 窗口、地区、相关查询和数据不可用状态。

### 6.4 风向标与公开社区

风向标、GitHub、Product Hunt、Reddit、X、YouTube、Hacker News 等都只作为来源适配器。首版优先实现生财 MCP、Product Hunt、GitHub、X 已知账号时间线和 Reddit 配置社区 RSS。转载内容应通过 URL、标题、正文指纹和作者关系去重，避免虚假的多来源验证。

“先抓新内容，再做定向验证”是首版采集原则。系统不能依赖搜索一个尚未知道的词来发现新词：先从来源内容中抽取表达，之后才用 X、Reddit 或 Google Trends 对候选进行定向确认。

## 7. 资格与推荐规则

### 7.1 发现阶段

满足任一条件即可进入发现池：

- 新的下拉词或相关查询；
- 新产品、模型、平台或功能表达；
- 用户首次提出的具体问题；
- 风向标中的新玩法或新需求；
- 竞品页面首次出现的新表达。

### 7.2 观察阶段

至少具备一项新鲜度、趋势、互动或用户问题信号，并且没有立即触发风险驳回。

### 7.3 可行动阶段

至少具备：

- 一项需求证据；
- 一项竞争或供给证据；
- 一项交付能力或商业证据；
- 明确的用户和页面/产品形态；
- 无未处理的高风险标记。

### 7.4 自动驳回或降级

- 只有一个无法验证的传闻；
- 仅有品牌词且没有合法授权或差异化用途；
- 趋势已明显衰退且没有长期需求证据；
- SERP 强竞争且没有可解释的切入点；
- 医疗、金融、成人、版权、账号服务等风险未完成人工复核；
- 收入、销量或流量只有作者口述，不能当成已验证商业证据。

## 8. 报告格式

每次运行生成：

```text
data/runs/YYYY-MM-DD/raw-signals.jsonl
data/runs/YYYY-MM-DD/expressions.json
data/runs/YYYY-MM-DD/opportunities.json
data/runs/YYYY-MM-DD/evidence.json
data/runs/YYYY-MM-DD/run-summary.json
reports/YYYY-MM-DD.md
data/history/opportunities.json
```

Markdown 报告结构：

1. 运行时间、来源覆盖和失败情况；
2. 今日可行动机会；
3. 正在验证的机会；
4. 新发现但证据不足的表达；
5. 下降、驳回和风险项；
6. 每条机会的证据表；
7. 下一步验证动作。

报告中的每条结论都必须包含证据状态，不能只显示模型生成的理由。

## 9. 错误与一致性

- 单个来源失败不得阻塞整次运行；
- 失败来源必须显示在报告中；
- 空结果、权限不足、同步延迟、限流和解析失败必须区分；
- 原始信号不可被后续运行覆盖；
- 聚合结果可以重建；
- 相同 `sourceType + externalId + sourceUrl + normalizedText` 应去重；
- 证据引用的原始信号不存在时，验证结果必须降级；
- 导入失败不得覆盖已有历史数据；
- 时间、地区、语言和来源口径缺失时必须标记不完整。

### 9.1 Source Health

每个来源每次运行必须产生一个健康记录：

```ts
type SourceHealth = {
  sourceType: string;
  status: "available" | "partial" | "blocked" | "empty" | "unverified";
  attemptedAt: string;
  endpointCount?: number;
  successfulEndpointCount?: number;
  itemCount: number;
  failureReasons: string[];
  coverageNotes: string[];
};
```

以下状态不能互相替代：

```text
没有发现新词 != 来源请求失败 != 被限流/拒绝 != 返回空数据
```

报告不得因为来源失败而输出“该来源没有新词”。

## 10. 测试策略

第一阶段测试覆盖：

- 中文、英文、大小写、标点和别名规范化；
- URL、正文指纹和转载去重；
- 单一来源不会伪造跨来源验证；
- 新词首次发现、重复发现、上升、稳定和衰退；
- 趋势数据窗口和地区不会互相覆盖；
- MCP 限流、权限失败、同步延迟和空结果分开处理；
- 缺少证据时机会自动降级；
- 高风险词不会因高热度直接进入可行动；
- 报告中每条判断都有有效证据引用；
- 失败导入不会破坏历史数据；
- 从 JSONL 原始信号重建聚合结果后结果稳定。

## 11. 后续实现顺序

1. 建立类型、存储和证据校验；
2. 实现表达规范化、去重和生命周期；
3. 实现 Source Health、人工/夹具导入和报告生成；
4. 接入生财 MCP 只读适配器；
5. 接入 Product Hunt 发布流和 GitHub 新仓库；
6. 接入 X 已知账号时间线和 Reddit 配置社区 RSS；
7. 接入 Google Trends 验证接口和 SERP/竞品验证；
8. 增加定时运行、增量历史和可选通知；
9. 在真实运行数据稳定后，再评估 Web 界面。

## 12. 首版成功标准

首版不是以“接入来源数量”作为成功标准，而是满足：

- 每天能稳定运行并生成报告；
- 至少一个稳定主干来源可用时，运行不会失败；
- 每条来源都能说明可用、部分可用、阻塞、空结果或未验证；
- 每个候选表达可以回到原文、作者、时间和来源；
- X 或 Reddit 不可用时，不会被错误报告为“没有新词”；
- 用户每天愿意从报告中挑选候选，继续用 Google Trends 或 SERP 人工确认；
- 连续运行后能记录哪些候选被采纳、驳回或进入后续产品验证。

本规格不承诺旧 `trend-word-new` 的兼容性。旧代码只有在满足本规格的边界、证据和测试要求时才迁移。
