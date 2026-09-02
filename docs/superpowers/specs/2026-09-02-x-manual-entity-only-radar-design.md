# X 人工采集与产品原文雷达设计

## 目标

把日报收敛为三条主线：

1. Product Hunt 只采集产品实体、tagline、description。
2. GitHub 只采集仓库实体、description、README。
3. X 不调用付费 API，由代理使用已登录的 Chrome 打开既有私有 List，读取过去 24 小时，人工筛选后写入当天人工输入文件。

反馈层不再参与默认流程：不抓 Product Hunt 评论，不抓 GitHub Issues，不把评论或 Issue 当作需求证据。

## 关键判断

Product Hunt/GitHub 的原文适合发现“产品能力表达”，但不能直接证明用户需求。系统可以从描述中生成短的能力搜索词，但报告必须标记为“产品能力推导”，并要求人工查 Google Trends 7d。

X 的价值不是批量搬运时间线，而是由代理先做一次人工判断：只录入新产品、新功能、新表达、明确的新场景或值得验证的需求线索。转发、泛观点、营销句和无法压缩成短词的内容不进入候选池，但必要时可以保留在人工采集文件的原文记录中。

## 默认日报流程

```text
已登录 Chrome 的 X 私有 List
        ↓ 过去 24 小时人工筛选
data/runs/YYYY-MM-DD/x-web-input.jsonl
        ↓ 默认运行自动发现当天文件
Product Hunt 实体原文 + GitHub 仓库原文 + X 人工信号
        ↓ 去重、提炼能力词/新表达、排序
最多 10 个 Google Trends 7d 候选
```

默认日报运行时：

- 自动包含 Product Hunt 和 GitHub。
- 如果当天存在 `data/runs/YYYY-MM-DD/x-web-input.jsonl`，自动包含 `manual`，不需要再传 `--sources` 或 `--input`。
- 如果当天没有该文件，报告显示 `X（人工）: unverified` 和“当天人工输入缺失”，但运行仍完成，不把昨天的 X 数据带入今天。
- Reddit、SCYS 保留现有适配器和显式命令，但不进入默认日报，避免未验证来源稀释主报告。
- `x-timeline` API 适配器保留为显式实验入口，不作为默认 X 来源。

## X 人工采集 SOP

每天运行前，代理使用用户已登录的 Chrome：

1. 打开既有私有 List，不读取 cookie、localStorage、token 或浏览器配置文件。
2. 只看当前时间往前 24 小时；优先原创帖，必要时查看引用上下文。
3. 对每条候选做四项判断：是否新、是否具体、是否与 AI 工具/独立开发/工作流有关、是否能压缩成短的产品/能力/需求表达。
4. 过滤纯新闻转发、泛观点、无具体对象的情绪表达、重复内容和营销口号。
5. 将通过筛选的帖子写入当天 `x-web-input.jsonl`，保留 URL、正文、作者和发布时间；原文是证据，查询词由后续管道提炼。
6. 再运行日报，报告明确区分“X 原文信号”和“产品能力推导”。

人工输入文件每行使用现有 manual JSONL 格式，至少包含：

```json
{"id":"x-web-<status-id>","sourceType":"manual","sourceName":"X web list","sourceUrl":"https://x.com/<handle>/status/<id>","title":"帖子中最具体的新表达","body":"帖子原文","author":"@handle","publishedAt":"2026-09-02T03:00:00Z","evidenceStatus":"verified","sourceFingerprint":"x-web:<status-id>"}
```

## 查询词与证据边界

- 原始帖子、产品描述和 README 永远保留在 `raw-signals.jsonl` 或 manual 输入中。
- 产品描述只允许生成 `capability_derived` 能力词，例如 `AI application builder`；不能把描述包装成“用户原话”。
- X 人工信号中的明确新表达可作为 `user_evidence`，但必须是短词或短任务表达；完整句子只作为 `evidenceQuote`，不能成为 Trends 查询词。
- 无法可靠压缩的句子不进入正式验证池，也不为了凑够 10 个候选而强行改写。
- Google Trends 仍是人工 7d 验证边界，不调用未公开免费 API。

## 代码调整范围

- 停止 `enrichSignalsWithFeedback` 的默认调用，不再请求 GitHub Issues 和 Product Hunt comments。
- 保留历史反馈字段的兼容读取，避免旧日报无法解析；新日报不产生反馈统计和反馈信号。
- 默认运行自动探测当天 X manual 文件；显式 `--input` 仍可覆盖自动路径。
- 报告将 `manual` 来源显示为 `X（人工）`，并区分“当天输入缺失”和“有 X 信号但没有合格候选”。
- 默认来源调整为 Product Hunt、GitHub、X manual；Reddit/SCYS 仍可用但需显式指定。
- 更新 README、CLI、配置和相关测试，删除或停用默认反馈抓取测试路径。

## 验收标准

1. 默认运行存在当天 `x-web-input.jsonl` 时，X 被纳入且报告显示实际 X 信号数量。
2. 默认运行没有当天文件时，报告明确显示 X 人工输入缺失，运行状态仍为 `complete`。
3. 默认运行过程中没有 GitHub Issues 或 Product Hunt comments 请求。
4. Product Hunt/GitHub 的实体描述仍能生成能力词，并保留原文、来源 URL 和“产品能力推导”标签。
5. 完整句子、评论口号和 Issue 标题不会进入 Trends 正式池。
6. Reddit/SCYS 显式运行仍不受破坏。
7. 所有现有测试和新增回归测试通过，构建通过，报告真实回放结果可审计。
