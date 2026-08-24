# New Word Opportunity Radar

本地、无网络的新词机会雷达 MVP。使用 fixture corpus 或手工 JSONL/CSV 输入运行每日报告：

```bash
pnpm radar -- --date 2026-08-24 --sources fixtures --workspace /tmp/radar-plan-check
pnpm radar -- --date 2026-08-24 --sources manual --input ./signals.jsonl --workspace /tmp/radar-manual
```

报告和审计数据写入 `data/runs/YYYY-MM-DD/`，包括 raw signals、expressions、evidence、opportunities、run-summary 和 Markdown 报告。来源失败或部分覆盖会在报告中保留并明确不代表没有新词。
