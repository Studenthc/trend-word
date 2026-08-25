# New Word Opportunity Radar

本地、fixture-first、无隐式网络的新词机会雷达 MVP。每日 workflow：

1. 在本地 runtime 配置 SCYS MCP access；如果实际入口是已登录的 SCYS 网页，可使用 `createScysWebApiTransport` 对齐网页后端请求。credentials 只留在 runtime transport，不写入 RawSignal、报告或 fixtures。
2. 先用 fixture mode 跑一遍，确认 pipeline 和报告可生成。
3. 先查看 source health，再阅读机会；`blocked`、`partial`、`unverified` 不等于没有新词。
4. 对需要验证的候选手工打开 Google Trends，记录 24h/7d、地区、value/delta 和 related queries。
5. 记录决定：keep、pause、reject 或 execute。

运行方式：

```bash
pnpm radar -- --date 2026-08-24 --sources fixtures --workspace /tmp/radar-plan-check
pnpm radar -- --date 2026-08-24 --sources manual --input ./signals.jsonl --workspace /tmp/radar-manual
pnpm radar -- --date 2026-08-24 --workspace /tmp/radar-configured
```

报告和审计数据写入 `data/runs/YYYY-MM-DD/`，包括 raw signals、expressions、evidence、opportunities、run-summary 和 Markdown 报告。每条原文 evidence 保留 source URL 与 evidence grade。

Google Trends 是 `manual-or-optional` verification boundary：当前不调用 undocumented free API；没有 provider 时显示 `Google Trends 未验证`，不会伪造 zero/declining，也不会删除候选。X timeline 与 Reddit feed 是 conditional coverage，只查询显式 configured handles/communities；successful run 不代表完整社媒覆盖。Product Hunt、GitHub、SCYS 在没有 injected transport 时会明确报告 unavailable health。

SCYS 网页 runtime transport 的最小接线方式：宿主 runtime 注入带登录态的 `fetcher` 和 headers，再把返回的 transport 传给 `runRadar({ transports: { "scys-mcp": transport } })`。项目不会读取浏览器 cookie、localStorage 或 token；没有 runtime 注入时保持 `unverified`。

每日 Chrome 自动任务使用 `scripts/scys-browser-runtime.mjs`：任务接管已打开的 `https://scys.com/activity/documents?...` tab，调用 `createScysBrowserTransport(tab)`，再把 transport 注入 `runRadar`。任务必须在结束时释放 tab；若找不到登录态 tab，报告阻塞原因，不把结果降级为空来源。

报告中的 `Google Trends 候选（过去 7 天）` 只收录有正文上下文的具体词，标题-only 线索会进入 `备选线索`。候选链接使用固定的 `now 7-d` 窗口；系统不伪造趋势值。完成 Trends 复核后可记录反馈：

```bash
pnpm radar -- feedback --candidate candidate-ai短剧带货 --decision keep --workspace /tmp/radar-scys-today
pnpm radar -- feedback --candidate candidate-某个词 --decision skip --reason "竞争太强" --workspace /tmp/radar-scys-today
```

反馈保存在 `data/feedback/candidate-feedback.jsonl`，下一次排序会提高 `keep`、降低 `skip`，并保留原始决策历史。
