# New Word Opportunity Radar

本地、fixture-first 的种子词雷达：保留所有来源原始线索作为发现池，从用户原话、问题、产品、模型、功能和玩法中抽取 `SeedTerm`，再将别名归并为表达簇，筛出最多 10 个适合手工打开 Google Trends 验证的今日验证池。系统负责减少检索劳动，不替用户判断商业价值。

每日 workflow：

1. 在本地 runtime 配置 SCYS MCP access；如果实际入口是已登录的 SCYS 网页，可使用 `createScysWebApiTransport` 对齐网页后端请求。credentials 只留在 runtime transport，不写入 RawSignal、报告或 fixtures。
2. 先用 fixture mode 跑一遍，确认 pipeline 和报告可生成。
3. 先看 `今日验证池`，再看来源状态；`blocked`、`partial`、`unverified` 不等于没有新词。
4. 对不超过 10 个候选手工打开 Google Trends，重点记录过去 7 天增速、地区、value/delta 和 related queries。
5. 记录决定：`keep`、`skip` 或 `false_positive`。

运行方式：

```bash
pnpm radar -- --date 2026-08-24 --sources fixtures --workspace /tmp/radar-plan-check
pnpm radar -- --date 2026-08-24 --sources manual --input ./signals.jsonl --workspace /tmp/radar-manual
pnpm radar -- --date 2026-08-24 --workspace /tmp/radar-configured
```

报告和审计数据写入 `data/runs/YYYY-MM-DD/`。其中 `raw-signals.jsonl`、`seed-terms.json`、`expression-clusters.json`、`evidence.json` 和 `discovery-summary.json` 是发现池与来源审计数据，`candidates.json` 是今日验证池。Markdown 报告先展示用户表达和原文证据，再给 Trends 验证链接；不会倾倒完整正文。

Google Trends 是 `manual-or-optional` verification boundary：当前不调用 undocumented free API；没有 provider 时显示 `Google Trends 未验证`，不会伪造 zero/declining，也不会删除候选。SCYS 是当前主需求来源，每日默认检索 `AI`、`带货`、`视频号`；搜索结果只读取当前可见搜索弹窗，不能把页面背景资料当成 query 结果。GitHub 只负责近期工具/产品实体发现，不能把 `owner/repo` 直接当趋势词。Product Hunt、Reddit、X 当前没有可靠 transport，已从每日主流程禁用；恢复前不能伪装成可用或把失败当成空结果。

SCYS 网页 runtime transport 的最小接线方式：宿主 runtime 注入带登录态的 `fetcher` 和 headers，再把返回的 transport 传给 `runRadar({ transports: { "scys-mcp": transport } })`。项目不会读取浏览器 cookie、localStorage 或 token；没有 runtime 注入时保持 `unverified`。

每日 11:00 Chrome 自动任务使用 `scripts/scys-browser-runtime.mjs`：任务接管已打开的 `https://scys.com/activity/documents?...` tab，调用 `createScysBrowserTransport(tab,{browser,activityId:10095})`，通过可见的 SCYS 资料搜索结果打开 `/t/<短码>` 详情标签并读取详情页正文，再把 transport 注入 `runRadar`。SCYS 与 GitHub 分别使用 `scysTransport` 和 `httpTransport`；任务结束时必须在 `finally` 中调用 `browser.tabs.finalize({keep:[]})`。若找不到登录态 tab，报告阻塞原因，不把结果降级为空来源。详情页仍无法打开时，结果保留为 partial，不把标题冒充正文。

报告中的 `今日验证池` 只收录有正文/产品描述、日期、链接和具体词的候选；标题-only 线索会进入 `新发现但证据不足`，并明确缺少的验证项。候选链接使用固定的 `now 7-d` 窗口；系统不伪造趋势值。来源失败、权限阻塞和空结果仍然分别报告。完成 Trends 复核后可记录反馈：

```bash
pnpm radar -- feedback --candidate candidate-ai短剧带货 --decision keep --workspace /tmp/radar-scys-today
pnpm radar -- feedback --candidate candidate-某个词 --decision skip --reason "竞争太强" --workspace /tmp/radar-scys-today
```

反馈保存在 `data/feedback/candidate-feedback.jsonl`，下一次排序会提高 `keep`、降低 `skip`，并保留原始决策历史。
