# SCYS 登录态每日新词雷达设计

## 目标

每天使用现有 Chrome 登录态读取 SCYS 资料库，运行新词机会雷达并生成可追溯日报；不读取、不导出、不持久化 Cookie、localStorage 或 Token。

## 方案

定时任务负责触发，浏览器 runtime 负责提供当前已登录 SCYS tab。项目新增浏览器采集 helper，将资料库搜索结果转换为现有 `McpTransport` 形状，再调用 `runRadar`。搜索结果没有展开正文时保留标题、作者、日期，并标记 `partial/reported`；失败、无结果和权限阻塞保持可区分。

## 数据流

```text
每日任务 -> Chrome 登录态 tab -> SCYS 资料库搜索 -> McpTransport
  -> scys-mcp adapter -> raw/evidence/opportunity/history -> report.md
```

## 边界

- 只读取资料库搜索结果，不自动发帖、评论、点赞或提交表单。
- 不把认证信息写入源码、配置、RawSignal、报告或 fixture。
- Google Trends 仍是后置人工验证，不伪造趋势数据。
- 没有可用登录 tab 时任务失败并报告原因，不转成空结果。

## 验收

- 可用当前登录态完成一次 SCYS 查询并进入 pipeline。
- source health 对正文未展开结果为 `partial`，evidence grade 为 `reported`。
- 每日任务输出报告路径和候选数量。
- 测试、构建和 diff 校验通过。
