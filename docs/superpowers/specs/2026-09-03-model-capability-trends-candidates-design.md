# Model Capability Trends Candidate Design

## Goal

让 Hugging Face 和 fal.ai 的公开模型目录成为 Google Trends 待查词的直接发现源。模型能力本身可以被压缩成具体任务型搜索词，不要求先与 X、Product Hunt、GitHub 或 SCYS 需求证据拼接。

## Boundary

模型目录提供的是“能力线索”，不是用户原话。系统必须保留模型原文、模型 URL 和 `capability_derived` 来源标记；模型名称、版本号、平台 slug、泛化标签不能单独成为需求词。

“今日先查”表示进入人工 Google Trends 过去 7 天验证队列，不表示已经证明有需求。只有 Trends 核验后，才进入机会判断。Google Trends 仍是人工验证边界，不伪造搜索量或增长结论。

## Flow

```text
Hugging Face / fal.ai model records
  -> concrete capability normalization
  -> task query and explicit combination query
  -> at most 10 Google Trends candidates
  -> manual 7-day Trends verification
  -> opportunity judgment
```

模型能力候选可以进入正式验证队列；它们不需要外部用户证据才能进入该队列，但必须满足能力词具体、可搜索、来源 URL 存在和非模型名/版本号的条件。

## Query rules

能力映射使用固定、可复现的任务词表，例如：

- `image-to-video` -> `image to video`
- `product-photo-to-video` -> `product photo to video`
- `lip-sync` -> `lip sync video generator`
- `local-inference` -> `local inference engine`

两个模型能力只有在固定 recipe 明确允许且输入输出可衔接时，才生成组合词，例如 `text-to-image + image-to-video` -> `text to video from image`。组合词同样是能力推导词和 Trends 待查词，不是用户原话。

## Candidate and report behavior

- 模型能力映射和组合假设进入每日最多 10 个待查候选的统一队列。
- 候选类型显示为“产品能力推导，待 Google Trends 验证”。
- 不再要求“外部需求证据”才能从模型目录进入待查队列。
- 证据行显示模型能力原文和模型链接；不显示“用户原话”。
- 报告的模型区仍保留平台覆盖状态、归一化能力、映射和组合，但保持紧凑。
- 没有模型能力候选时，报告明确显示没有可查能力词，不把模型库存数量伪装成需求量。

## Failure and evidence semantics

- 公开接口 blocked、unverified、partial 仍是来源覆盖状态，不等于没有需求。
- fal.ai 缺少可信目录时间时保持 `partial`。
- 模型目录没有可归一化能力时，不生成候选；模型实体仍保存在模型库存以便复查。
- 任何模型推导词都保留 `capability_derived`、映射 ID、source signal ID 和原文 URL。

## Validation

- 单元测试覆盖能力映射、组合映射、候选进入 Trends 队列和报告标签。
- 管线测试确认模型推导候选进入 formal verification queue，且没有用户原话标签。
- 真实公开源运行检查：模型能力候选不超过 10 条，每条有模型 URL，报告只声称“待 Trends 验证”。
