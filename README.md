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
