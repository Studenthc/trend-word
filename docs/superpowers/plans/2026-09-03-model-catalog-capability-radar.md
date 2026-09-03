# Model Catalog Capability Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add low-cost Hugging Face and fal.ai public model catalogs as traceable capability-discovery sources, derive concise task queries and bounded two-stage workflow hypotheses, and keep them separate from proven user demand in the daily radar.

**Architecture:** A single model-catalog source adapter fetches the two public catalogs through injected or opt-in public HTTP transports. Each adapter maps bounded upstream records to a ModelRecord plus a RawSignal; the pipeline normalizes capabilities, derives capability_derived demand expressions, generates only explicit compatible two-stage combinations, persists four JSON projections, and renders a compact model section. Model-derived items stay in the observation lane until an independent demand source produces corroborating evidence.

**Tech Stack:** TypeScript, Zod, Vitest, native fetch, existing SourceAdapter/HttpTransport contracts, JSON projections in RunStore, Markdown reports.

---

## File map

- Create: src/sources/huggingface.ts — official API request, response parsing, recency filtering, deduplication, and ModelRecord conversion.
- Create: src/sources/fal-ai.ts — public explore HTML parsing, URL allow-listing, model-path normalization, and partial/unverified coverage semantics.
- Create: src/sources/model-catalog.ts — combines platform collectors into one SourceAdapter, creates model RawSignals, and reports per-platform coverage.
- Create: src/domain/model-capabilities.ts — controlled capability taxonomy, model normalization, task-query mapping, and capability-derived DemandExpression conversion.
- Create: src/domain/model-combinations.ts — explicit two-stage recipe rules, compatibility checks, deduplication, and combination-derived DemandExpression conversion.
- Modify: src/types.ts — add model-catalog, model schemas, optional model records on SourceCollection, and model counts on DiscoverySummary.
- Modify: src/config.ts and radar.config.json — add safe modelCatalog defaults and enable it as best-effort discovery.
- Modify: src/sources/source.ts — validate and preserve optional modelRecords returned by an adapter.
- Modify: src/index.ts — wire the model adapter, collect records, build derived demands, write projections, pass report data, and include source roles.
- Modify: src/domain/candidates.ts — keep model-catalog-derived candidates in observation and preserve evidence ranking.
- Modify: src/report/markdown.ts — add a compact capability/combination section without dumping descriptions.
- Modify: src/storage/run-store.ts — validate and read/write four model projections.
- Modify: README.md — document the public credential-free model source and artifacts.
- Create tests: tests/sources/huggingface.test.ts, tests/sources/fal-ai.test.ts, tests/sources/model-catalog.test.ts, tests/domain/model-capabilities.test.ts, tests/domain/model-combinations.test.ts.
- Modify tests: tests/config.test.ts, tests/sources/source-health.test.ts, tests/report.test.ts, tests/pipeline.test.ts, tests/candidates.test.ts, tests/storage.test.ts where new source/projection expectations change.

## Data contracts

Use these persisted fields so every model artifact is independently inspectable:

~~~ts
type ModelRecord = {
  id: string;
  platform: "huggingface" | "fal-ai";
  modelName: string;
  modelUrl: string;
  createdAt?: string;
  updatedAt?: string;
  inputTypes: string[];
  outputTypes: string[];
  claimedCapabilities: string[];
  description?: string;
  tags: string[];
  publicMetrics?: { likes?: number; downloads?: number; stars?: number };
  notes: string[];
  sourceSignalId: string;
  evidenceStatus: "verified" | "partial" | "unverified";
};
~~~

ModelCapability stores capability, model IDs, platforms, input/output types, source quotes, source URLs, and evidence status. KeywordModelMapping stores the task keyword, capability ID, model IDs, source signal IDs/URLs, original text, transformation, origin capability_derived, quality state review, and evidence status inferred. ModelCombination stores at most two typed steps, capabilityChain, combinedQuery, candidateModels, compatibilityReason, feasibilityNotes, and evidence status inferred.

No model name, version, or platform slug is emitted as a demand expression by itself.

### Task 1: Extend typed source and projection contracts

**Files:** src/types.ts, src/sources/source.ts, src/storage/run-store.ts, tests/sources/source-health.test.ts, tests/storage.test.ts

- [ ] Step 1: Write failing schema tests for model-catalog, a complete ModelRecord, SourceCollection.modelRecords, and all four projection names.
- [ ] Step 2: Run: pnpm exec vitest run tests/sources/source-health.test.ts tests/storage.test.ts. Expected: RED because the source type, parser, and projection names do not exist.
- [ ] Step 3: Add Zod schemas and parsers for ModelPlatform, ModelRecord, ModelCapability, KeywordModelMapping, and ModelCombination. Add modelRecords optional to SourceCollection and model-catalog to sourceTypeSchema.
- [ ] Step 4: Add optional DiscoverySummary fields: modelInventoryCount, capabilityCount, modelKeywordCount, modelCombinationCount, modelFormalDemandCount, modelWatchDemandCount. Keep them optional for old runs.
- [ ] Step 5: Parse and preserve result.modelRecords in safe-source validation; reject malformed records with the existing named validation style.
- [ ] Step 6: Register model-inventory, capabilities, keyword-model-mapping, and model-combinations array validators in RunStore.
- [ ] Step 7: Rerun the focused tests and confirm the old source validation tests remain green.

### Task 2: Add safe configuration and Hugging Face

**Files:** src/types.ts, src/config.ts, radar.config.json, src/sources/huggingface.ts, tests/config.test.ts, tests/sources/huggingface.test.ts

- [ ] Step 1: Write failing tests for this exact default:
~~~ts
modelCatalog: {
  enabled: true,
  platforms: ["huggingface", "fal-ai"],
  recentDays: 7,
  limitPerPlatform: 20,
}
~~~
Also test the request query, a recent image-to-video model, seven-day filtering, duplicate collapse, undated partial records, malformed JSON, 403, and 429.
- [ ] Step 2: Run: pnpm exec vitest run tests/sources/huggingface.test.ts tests/config.test.ts. Expected: RED because modelCatalog and the adapter do not exist.
- [ ] Step 3: Extend config schema/defaults and add model-catalog to sources.bestEffort. Never add credential fields.
- [ ] Step 4: Implement createHuggingFaceAdapter. Fetch only https://huggingface.co/api/models?sort=lastModified&direction=-1&limit=<bounded-limit>. Accept a top-level array or items array; read id/modelId, lastModified/updatedAt, createdAt, pipeline_tag, tags, likes, downloads; map known pipeline tags to input/output types and retain unknown tags as claimedCapabilities.
- [ ] Step 5: Filter records older than fetchedAt minus recentDays; retain undated records with a missing-timestamp note and partial evidence; dedupe IDs; stop at limitPerPlatform; construct HTTPS model URLs and deterministic sourceSignalId values.
- [ ] Step 6: Return blocked for 401/403/429, unverified for malformed/non-2xx, empty for valid zero data, and available/partial for usable records. Never represent an error as empty demand.
- [ ] Step 7: Run adapter/config tests and confirm GREEN.

### Task 3: Add fal.ai and the combined source

**Files:** src/sources/fal-ai.ts, src/sources/model-catalog.ts, tests/sources/fal-ai.test.ts, tests/sources/model-catalog.test.ts

- [ ] Step 1: Write a fal.ai fixture test with observed paths:
~~~html
<a href="/models/minimax/h3-max/image-to-video"><img alt="Image to video with audio" /></a>
<a href="/models/bytedance/seedance-2.5/image-to-video"><span>Seedance</span></a>
~~~
Assert unique HTTPS fal.ai model URLs, image input/video output, path capability extraction, script/non-model exclusion, partial status for records without trustworthy timestamps, and unverified for a non-empty page with no model links.
- [ ] Step 2: Run: pnpm exec vitest run tests/sources/fal-ai.test.ts. Expected: RED because the adapter does not exist.
- [ ] Step 3: Implement a bounded HTTPS allow-listed parser for https://fal.ai/explore. Extract unique /models/... hrefs, decode entities, derive readable names from path segments, and infer only concrete path capabilities such as image-to-video, text-to-image, text-to-video, lip-sync, and image-editing. Persist no arbitrary href or page-wide HTML.
- [ ] Step 4: Leave fal timestamps absent, add a note that public explore HTML has no trustworthy catalog timestamp, set records partial, and cap results at limitPerPlatform. Valid HTML with no model links is unverified because it may indicate a structure change.
- [ ] Step 5: Write combined-source tests with one successful HF transport and one fal transport. Assert one model RawSignal per model, sourceType model-catalog, signalKind entity, platform sourceName, and model-catalog:<platform> tags. Assert one platform 429 leaves the other platform's models and yields overall partial health.
- [ ] Step 6: Implement createModelCatalogAdapter. Missing transport is unverified for that platform. Convert ModelRecord to a RawSignal with URL, modelName, description/capability text, trustworthy publishedAt, first_party tier, entity signalKind, deterministic fingerprint, and platform tag. Put per-platform counts/statuses in coverageNotes.
- [ ] Step 7: Aggregate available/partial/blocked/unverified/empty as specified by the source design; only all-platform valid zero results may be empty.
- [ ] Step 8: Run all source tests and confirm GREEN.

### Task 4: Normalize capabilities and task queries

**Files:** src/domain/model-capabilities.ts, tests/domain/model-capabilities.test.ts

- [ ] Step 1: Write failing tests for image-to-video, lip-sync, local GGUF inference, generic multimodal, and a model named only acme/awesome-v2. Assert mappings image-to-video -> image to video, lip-sync -> lip sync video generator, local-inference -> local inference engine; assert equivalent spellings merge and every mapping has a URL.
- [ ] Step 2: Run: pnpm exec vitest run tests/domain/model-capabilities.test.ts. Expected: RED because the normalizer does not exist.
- [ ] Step 3: Implement a fixed rule table over modelName, description, claimedCapabilities, tags, inputTypes, and outputTypes. Include concrete labels:
~~~text
image-to-video -> image to video
image-to-video-with-audio -> image to video with audio
reference-to-video -> reference to video
character-consistent-video -> character consistent video generator
product-photo-to-video -> product photo to video
first-last-frame-video -> first last frame video
speech-to-text-translation -> speech to text translation
lip-sync -> lip sync video generator
accurate-text-rendering -> image generator with text
example-based-image-editing -> example based image editing
editable-svg -> editable svg generator
local-inference -> local inference engine
text-to-image -> text to image generator
text-to-video -> text to video generator
text-to-speech -> text to speech
speech-to-text -> speech to text
~~~
Reject broad AI generation, multimodal, and platform labels and anything supported only by an opaque model name/version.
- [ ] Step 4: Emit one ModelCapability per normalized capability with sorted IDs/platforms/types, source quotes, URLs, and aggregated evidence.
- [ ] Step 5: Emit one KeywordModelMapping per capability/query pair with deterministic IDs, sorted source lists, origin capability_derived, qualityState review, evidenceStatus inferred, and a transformation saying the model name is not the demand word.
- [ ] Step 6: Export modelMappingsToDemandExpressions. Use task type, inferred grade, semantic precision, review state, capability_derived origin, mapping ID as sourceEntityId, first model sourceSignalId/sourceUrl, and bounded quote/sourceText. Expression text is only the task query.
- [ ] Step 7: Run capability tests and confirm GREEN.

### Task 5: Generate explicit two-stage combinations

**Files:** src/domain/model-combinations.ts, tests/domain/model-combinations.test.ts

- [ ] Step 1: Write failing tests asserting image-to-video + text-to-speech produces product photo video with voiceover, image-to-video + lip-sync produces a lip-sync workflow, unrelated capabilities produce none, no result has more than two steps, and duplicates collapse.
- [ ] Step 2: Run: pnpm exec vitest run tests/domain/model-combinations.test.ts. Expected: RED because the generator does not exist.
- [ ] Step 3: Implement a fixed recipe table, not a Cartesian product:
~~~text
image-to-video + text-to-speech -> product photo video with voiceover
image-to-video + lip-sync -> lip sync video generator
text-to-image + image-to-video -> text to video from image
speech-to-text + translation -> speech translation
~~~
Require both capabilities and either output/input intersection or the recipe's explicit bridge rule. Narration uses explicit user-provided script text; lip-sync requires video input.
- [ ] Step 4: Emit at most one result per normalized chain, cap at 20, retain model IDs/source URLs, and set evidenceStatus inferred with feasibility notes.
- [ ] Step 5: Export modelCombinationsToDemandExpressions using the first model source signal, combination ID, quote prefixed with 组合假设：, capability_derived origin, inferred grade, semantic precision, and review state.
- [ ] Step 6: Run combination/capability tests and confirm GREEN.

### Task 6: Wire pipeline and candidate gate

**Files:** src/index.ts, src/domain/candidates.ts, src/report/summary.ts, src/storage/run-store.ts, tests/candidates.test.ts, tests/pipeline.test.ts

- [ ] Step 1: Write failing tests injecting a model-catalog adapter with one ModelRecord. Assert source health, four projections, model counts, report model data, no model-catalog-derived formal candidate, and a model-derived backup candidate. Assert direct manual/X evidence remains formal for the same normalized query.
- [ ] Step 2: Run: pnpm exec vitest run tests/candidates.test.ts tests/pipeline.test.ts. Expected: RED because source selection and projections are not wired.
- [ ] Step 3: Extend StableSourceType and InjectedSourceTransports for model-catalog; support modelCatalog.huggingface/falAi plus aliases. Construct it only when enabled and injected transports or RADAR_ENABLE_PUBLIC_HTTP=1 exist; no credentials.
- [ ] Step 4: Accumulate modelRecords from SourceCollection, build capabilities/mappings/combinations and derived demands after source collection, append them to extracted demands, and write all four projections including empty arrays.
- [ ] Step 5: Pass a compact model view to the report, count modelFormalDemandCount/modelWatchDemandCount from the final queue, and add model-catalog as discovery.
- [ ] Step 6: In candidateForDemand force backup for model-catalog plus capability_derived. Use missing fields 用户原话/替代诉求待确认, Google Trends 7d, SERP/供给 and reason 模型目录能力/组合假设，仅观察，等待外部需求证据. Preserve direct-evidence ranking and formal limit 10.
- [ ] Step 7: Add model counts and four artifact paths to summary/report location. Blocked/unverified health must not become empty.
- [ ] Step 8: Run: pnpm exec vitest run tests/candidates.test.ts tests/pipeline.test.ts tests/storage.test.ts and confirm GREEN.

### Task 7: Render compact provenance-aware output and document it

**Files:** src/report/markdown.ts, README.md, tests/report.test.ts

- [ ] Step 1: Write failing report tests for:
~~~text
## 模型能力雷达
模型目录：Hugging Face 1 条 · fal.ai 1 条；归一化能力 2 条；需求表达 2 条；组合假设 1 条
产品能力推导：image to video · 待外部需求证据
组合假设：product photo video with voiceover · image-to-video -> text-to-speech
~~~
Assert URLs, the external-evidence reminder, no 用户原话 label for model output, no long description dump, and named unverified fal coverage rather than fal.ai 0 条.
- [ ] Step 2: Run: pnpm exec vitest run tests/report.test.ts. Expected: RED because model report data/section does not exist.
- [ ] Step 3: Extend MarkdownReportInput with optional model data. Render no more than five mappings and three combinations after source status and before the funnel; each line has query, evidence state, and source URL. Keep existing candidate and quote limits.
- [ ] Step 4: Update README with public endpoint behavior, RADAR_ENABLE_PUBLIC_HTTP=1 gate, no credentials/weights/paid APIs, observation-only output, external-evidence promotion rule, and four artifact paths.
- [ ] Step 5: Run report/pipeline tests and confirm GREEN.

### Task 8: Real endpoints and final verification

**Files:** inspect data/runs/2026-09-03/report.md, model-inventory.json, capabilities.json, keyword-model-mapping.json, model-combinations.json; modify only files required by failing checks.

- [ ] Step 1: Run focused tests and build:
~~~bash
pnpm exec vitest run tests/sources/huggingface.test.ts tests/sources/fal-ai.test.ts tests/sources/model-catalog.test.ts tests/domain/model-capabilities.test.ts tests/domain/model-combinations.test.ts tests/candidates.test.ts tests/report.test.ts tests/pipeline.test.ts tests/storage.test.ts
pnpm build
~~~
- [ ] Step 2: Run only the new source through real public HTTP:
~~~bash
RADAR_ENABLE_PUBLIC_HTTP=1 NODE_ENV=production pnpm radar -- --date 2026-09-03 --sources model-catalog --workspace /Users/huchenhao/code/website/github/trend-word-2
~~~
Record exit code, model-catalog status, per-platform notes, model count, and four artifact counts. Do not retry a 429.
- [ ] Step 3: Inspect real output: every mapping has a model URL; every combination has at most two steps; no model name/version is a keyword alone; model-derived candidates are observation-only; source failures are visible; report remains compact.
- [ ] Step 4: Run pnpm test, pnpm build, and git diff --check. If file-parallel Vitest is flaky, rerun pnpm exec vitest run --no-file-parallelism and report exact results.
- [ ] Step 5: Review git status --short, git diff --stat, and git diff --check. Stage only scoped model-catalog files, preserve untracked memory/, and commit/push only after fresh verification; never reset or force-push.

## Self-review checklist

- [ ] HF uses official public API with strict time/quantity bounds.
- [ ] fal.ai uses bounded HTTPS allow-listed HTML and exposes uncertainty.
- [ ] Platform failures are blocked, partial, or unverified, never empty demand.
- [ ] Model names/versions remain context, not demand words.
- [ ] Mapping/combination records retain original model URL and source signal ID.
- [ ] Capability/combination expressions are review/inferred and model-only observation.
- [ ] Combination generation is explicit, compatible, at most two stages, deduplicated, and capped.
- [ ] Formal queue remains at most 10 and is not filled by model-only evidence.
- [ ] Report is compact and provenance-aware.
- [ ] No credentials, weights, or paid APIs are introduced.
- [ ] Existing memory/ content and unrelated changes remain untouched.
