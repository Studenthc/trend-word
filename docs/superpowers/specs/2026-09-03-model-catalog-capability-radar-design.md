# 模型目录能力与组合需求雷达设计

日期：2026-09-03
状态：设计已获确认，待实现

## 1. 背景与目标

现有雷达主要从 X、GitHub、Product Hunt 和人工输入发现新表达。Hugging Face、fal.ai 等模型目录提供了另一类早期信号：新模型、新输入输出形式和新能力可能先出现于模型平台，随后才被用户讨论或搜索。

本功能把模型平台作为“能力发现源”，不把模型名称直接当作需求词。它需要回答四个问题：

1. 最近出现或更新了哪些可用模型能力？
2. 这些能力可以被压缩成什么任务型搜索表达？
3. 哪些模型可以串成真实可执行的工作流？
4. 哪些能力或组合已经有外部需求证据，值得进入 Google Trends 和建站验证？

目标是形成可追溯的链路：

```text
模型目录 → 模型库存 → 能力归一化 → 需求词/组合假设
                                     ↓
                   X、Reddit、GitHub、Product Hunt、Trends 验证
                                     ↓
                              建站候选队列
```

## 2. 范围与边界

### 本期范围

- 首批来源：Hugging Face 和 fal.ai 的公开模型目录。
- 只抓取有限字段：平台、模型名、模型 URL、创建/更新时间、输入类型、输出类型、能力描述、标签、可用的价格或速度备注。
- 统一生成短小、任务导向的能力标签，例如 `image-to-video`、`product-photo-to-video`、`character-consistent-video`、`local-inference`。
- 从模型描述生成 `capability_derived` 需求表达，并保留原文、来源 URL 和转换理由。
- 根据输入输出类型和能力标签生成最多两阶段的模型组合假设。
- 模型目录只作为发现源；单独的模型记录、能力词和组合词默认进入观察区，不自动证明用户需求。
- 默认日报展示有限数量的高质量能力/组合线索，不增加正文长度倾倒。

### 不在本期范围

- 不调用 Google Trends 未公开 API，不伪造搜索量。
- 不购买模型平台套餐，不依赖私有 API 凭证。
- 不做模型质量排行榜、完整基准测试或自动生成工具页面。
- 不枚举所有理论上可拼接的模型组合。
- 不把纯模型名、版本号、开发者术语直接写入正式需求池。

## 3. 数据与来源设计

### 3.1 来源角色

新增 `model-catalog` 发现来源，具体平台由 `platform` 字段区分：`huggingface`、`fal-ai`。

模型来源的证据等级为“能力/实体证据”，不是用户需求证据：

- Hugging Face：关注近期创建或更新、任务标签、下载量/点赞等公开信号。
- fal.ai：关注公开模型目录中的新模型、可调用端点、输入输出和公开能力说明。
- 若来源限流、页面结构变化或无法确认时间范围，记录 `partial` / `unverified`，不能转换成“没有新模型”。

首版优先使用官方公开的机器可读接口；没有稳定接口时，只做域名白名单下的有界公开目录读取，并把解析失败作为来源状态暴露出来。

### 3.2 模型库存记录

每条模型记录保存到当天 `data/runs/YYYY-MM-DD/model-inventory.json`，字段为：

- `id`
- `platform`
- `modelName`
- `modelUrl`
- `createdAt`
- `updatedAt`
- `inputTypes`
- `outputTypes`
- `claimedCapabilities`
- `tags`
- `publicMetrics`
- `notes`
- `evidenceStatus`

同时保留一条 `RawSignal` 作为来源审计记录，`sourceType` 为 `model-catalog`，其 `title`、`body` 和 `sourceUrl` 不丢失原始模型描述。

### 3.3 来源配置

配置新增 `modelCatalog`：

- `enabled`
- `platforms`
- `recentDays`
- `limitPerPlatform`

默认平台为 Hugging Face、fal.ai，默认只看最近 7 天创建或更新的有限结果。用户可以显式关闭该来源或降低抓取数量。

## 4. 能力归一化

能力归一化器把模型标题、描述、任务标签和输入输出转成受控标签。首批标签覆盖图像、视频、音频、编辑、设计、开发者任务，示例包括：

- `image-to-video`
- `image-to-video-with-audio`
- `reference-to-video`
- `character-consistent-video`
- `product-photo-to-video`
- `first-last-frame-video`
- `speech-to-text-translation`
- `lip-sync`
- `accurate-text-rendering`
- `example-based-image-editing`
- `editable-svg`
- `local-inference`

规则：

- 合并明显同义词，保持标签短且面向任务。
- 过宽的“AI generation”“multimodal”等标签不能直接生成建站词，必须拆成具体输入、输出或任务。
- 过窄且只出现一次的模型术语只保留在模型备注，不进入需求词池。
- 每个标签必须可追溯到模型原文片段或结构化字段。

## 5. 需求词与组合需求

### 5.1 能力到需求词

模型描述只生成任务型候选，例如：

- `product photo to video`
- `character consistent video generator`
- `image to video with audio`
- `local inference engine`

模型名、版本号和平台名只作为观察上下文，除非它本身已经是用户明确搜索的产品词。所有模型推导词都标记为 `capability_derived`，状态为 `review`，并保留：

- 原始模型描述
- 原文片段
- 归一化能力
- 需求词转换说明
- 模型 URL

需求词先经过自然度、任务意图、需求证据和竞争角度检查。`low demand + high competition` 直接丢弃，`low demand + low competition` 只观察，不进入正式验证池。

### 5.2 组合模型发现

组合发现器把模型能力看成有输入输出的有向图，只允许明确兼容的连接：

- 图像输出 → 视频输入
- 音频输出 → 音频/口型同步输入
- 文本输出 → 图像/音频/视频提示输入
- OCR/视觉结构化输出 → CSV/文本清洗输入

每次最多生成两阶段组合，输出字段包括：

- `combinationId`
- `steps`
- `capabilityChain`
- `combinedQuery`
- `candidateModels`
- `compatibilityReason`
- `feasibilityNotes`
- `evidenceStatus`

例如：

```text
商品图 → 图片转视频 → 配音
候选表达：product photo video with voiceover
```

组合词默认是“组合假设”，只有在外部来源出现相近表达、重复任务或明显替代需求后，才允许进入正式 Trends 验证池。没有外部证据的组合不计入正式候选数量。

## 6. 与现有雷达的衔接

现有发现流程保持不变：

- X / Reddit：优先提供真实问题、使用反馈和自然表达。
- GitHub / Product Hunt：提供工具实体和产品能力描述。
- 模型目录：提供模型能力、输入输出和组合线索。
- Google Trends：人工验证过去 7 天搜索走势。
- SCYS：只做中文需求、玩法和变现场景验证。

模型目录不能绕过需求证据门槛。日报中新增一个精简的“模型能力雷达”区域，展示能力词、组合词和外部佐证状态；正式验证池仍最多 10 条。模型目录的来源状态、抓取数量和失败原因要进入来源审计。

内部优先使用 JSON 产物以匹配当前项目的运行目录：

- `model-inventory.json`
- `capabilities.json`
- `keyword-model-mapping.json`
- `model-combinations.json`

后续如果需要批量建站，再增加 CSV 导出，不在本期扩大运行链路。

## 7. 错误处理与成本控制

- 每个平台独立限流、超时和失败状态；一个平台失败不能阻断其他来源。
- 只抓取有限数量和有限时间范围，不下载模型权重或大文件。
- 不保存认证信息，不把 API token 写入原始信号或报告。
- 上游返回空结果、403、429、结构变化时，保留明确的 `empty` / `partial` / `unverified` 状态。
- 模型缺少输入输出或更新时间时，可以保留库存记录，但不能生成高置信组合。

## 8. 验证计划

实现必须先有回归测试覆盖：

1. Hugging Face 和 fal.ai 的公开响应解析、时间过滤、去重和限量。
2. 平台字段统一为 `ModelRecord`，失败响应不被当作零结果。
3. 同义能力归一化、过宽标签过滤和原文溯源。
4. 模型能力生成 `capability_derived` 需求词，且模型名不冒充需求词。
5. 输入输出兼容的两阶段组合生成、去重和组合数量上限。
6. 模型目录单独来源失败时，日报仍能生成并正确显示覆盖状态。
7. 正式候选仍不超过 10 条，观察候选不超过报告上限。

完成标准：可以用公开 fixture 和真实公开目录各跑一次，生成上述四类模型产物；至少有一条能力映射和一条组合假设可追溯到原始模型 URL；没有外部需求证据的模型词不会进入正式验证池。
