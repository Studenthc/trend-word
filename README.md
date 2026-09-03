# New Word Opportunity Radar

本地、fixture-first 的新表达雷达：保留所有来源原始线索作为发现池，从用户原话、问题、产品、模型、功能和玩法中抽取 `SeedTerm`，再将别名归并为表达簇，筛出最多 10 个适合手工打开 Google Trends 验证的正式候选。系统负责减少检索劳动，不替用户判断商业价值。

每日 workflow：

1. 先从 Product Hunt、GitHub，以及配置好的 X/Reddit/人工输入发现早期表达；SCYS 用 `AI`、`出海`、`风向标` 等词做中文需求与变现验证。credentials 只留在 runtime transport，不写入 RawSignal、报告或 fixtures。
2. 从普通用户句子、问题、产品/模型名称中抽取表达，按过去 7 天首次出现、重复提及和跨来源出现排序；SCYS 单独出现的产品名和功能名不会冒充新词。
3. 先看不超过 10 个 `今天先查` 正式候选，再看 `观察候选` 和来源状态；`blocked`、`partial`、`unverified` 不等于没有新词。
4. 对候选手工打开 Google Trends，重点记录过去 7 天走势、地区、value/delta 和 rising queries。
5. 可用 `verify` 保存人工结果，再记录决定：`keep`、`skip` 或 `false_positive`。

运行方式：

```bash
pnpm radar -- --date 2026-08-24 --sources fixtures --workspace /tmp/radar-plan-check
pnpm radar -- --date 2026-08-24 --sources manual --input ./signals.jsonl --workspace /tmp/radar-manual
pnpm radar -- --date 2026-08-24 --workspace /tmp/radar-configured
pnpm radar -- verify --date 2026-08-26 --candidate candidate-一人公司自动化 --result rising --region CN --note "过去 7 天明显上升" --workspace /tmp/radar-configured
```

报告和审计数据写入 `data/runs/YYYY-MM-DD/`。其中 `raw-signals.jsonl`、`seed-terms.json`、`expression-clusters.json`、`evidence.json` 和 `discovery-summary.json` 是发现池与来源审计数据，`candidates.json` 是今日验证池。Markdown 报告先展示用户表达和原文证据，再给 Trends 验证链接；不会倾倒完整正文。

Google Trends 是 `manual-or-optional` verification boundary：当前不调用 undocumented free API；没有 provider 时显示 `Google Trends 未验证`，不会伪造 zero/declining，也不会删除候选。发现源负责找刚出现的表达，SCYS 只负责中文需求、玩法和商业场景验证；SCYS 缺失是覆盖警告，不是“没有新词”。设置 `RADAR_ENABLE_PUBLIC_HTTP=1` 后，GitHub 会使用公开 API，Reddit 会读取配置的 `Entrepreneur`、`SaaS`、`artificial` 社区 feed；设置 `REDDIT_ACCESS_TOKEN` 后 Reddit 改走 OAuth API；设置 `X_BEARER_TOKEN` 后会读取配置的 OpenAI、AnthropicAI、karpathy、sama、levelsio 时间线；设置 `PRODUCT_HUNT_API_TOKEN` 后会使用官方 GraphQL API。可选的 `RADAR_GITHUB_TOKEN` 只用于请求头，不会写入任何报告或原始信号。GitHub 只负责近期工具/产品实体发现，不能把 `owner/repo` 直接当趋势词。没有凭证或 transport 的来源会明确显示 `unverified`，不能伪装成可用或把失败当成空结果。

SCYS 网页 runtime transport 的最小接线方式：宿主 runtime 注入带登录态的 `fetcher` 和 headers，再把返回的 transport 传给 `runRadar({ transports: { "scys-mcp": transport } })`。项目不会读取浏览器 cookie、localStorage 或 token；没有 runtime 注入时保持 `unverified`。

每日 11:00 Chrome 自动任务使用 `scripts/scys-browser-runtime.mjs`：任务接管已打开的 `https://scys.com/activity/documents?...` tab，调用 `createScysBrowserTransport(tab,{browser,activityId:10095,recentDays:7,maxSourcesPerQuery:3})`，先按可见卡片日期排序，再通过资料搜索结果打开 `/t/<短码>` 详情标签并读取正文，把 transport 注入 `runRadar`。SCYS 与 GitHub 分别使用 `scysTransport` 和 `httpTransport`；任务结束时必须在 `finally` 中调用 `browser.tabs.finalize({keep:[]})`。若找不到登录态 tab，报告阻塞原因，不把结果降级为空来源。详情页仍无法打开时，结果保留为 partial，不把标题冒充正文。

报告中的 `今天先查` 只收录用户问题、搜索意图或多来源具体表达；单一产品/功能实体进入 `观察候选`，并明确下一步需要的证据。候选链接使用固定的 `now 7-d` 窗口；系统不伪造趋势值。来源失败、权限阻塞和空结果仍然分别报告。完成 Trends 复核后可记录反馈：

```bash
pnpm radar -- feedback --candidate candidate-ai短剧带货 --decision keep --workspace /tmp/radar-scys-today
pnpm radar -- feedback --candidate candidate-某个词 --decision skip --reason "竞争太强" --workspace /tmp/radar-scys-today
```

反馈保存在 `data/feedback/candidate-feedback.jsonl`，下一次排序会提高 `keep`、降低 `skip`，并保留原始决策历史。
