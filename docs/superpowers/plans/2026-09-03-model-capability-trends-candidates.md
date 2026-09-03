# Model Capability Trends Candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Promote concrete model-capability expressions into the daily Google Trends verification queue while preserving their derived provenance.

**Architecture:** Keep Hugging Face and fal.ai collection and capability normalization in the existing model-catalog source layer. Change candidate policy so a concrete capability-derived task expression is a formal Trends verification candidate, while opaque model names and unknown labels remain excluded. Google Trends remains manual; no external demand source is required for this lane.

**Tech Stack:** TypeScript, Vitest, existing DemandExpression and RadarCandidate contracts, Markdown report renderer.

---

## Scope map

- Modify src/domain/candidates.ts: remove the model-only downgrade, use a Trends-only missing check for model-derived candidates, and retain provenance.
- Modify src/domain/model-capabilities.ts: recognize concrete capabilities in model descriptions and known catalog labels, and map them to task-shaped queries.
- Modify src/report/markdown.ts: replace model radar wording that asks for external demand evidence with wording that asks for Google Trends verification.
- Modify tests/candidates.test.ts: require model-derived capability candidates in the formal queue and keep opaque model entities out.
- Modify tests/domain/model-capabilities.test.ts: cover concrete description-derived capabilities and query mappings.
- Modify tests/pipeline.test.ts: update model formal/watch counts and queue assertions.
- Modify tests/report.test.ts: update the model radar label assertions.
- Modify docs/superpowers/specs/2026-09-03-model-capability-trends-candidates-design.md only if implementation reveals a contradiction; otherwise leave the approved specification unchanged.

## Invariants

- Every model-derived demand and candidate keeps origin capability_derived.
- Model names, versions, platform slugs, and broad labels never become query text.
- Formal means “send to the manual Trends check”; it does not mean demand is proven.
- No new credentials, paid API, automatic Trends measurement, or external source dependency is introduced.
- The existing maximum of 10 formal verification candidates remains in force.

### Task 1: Lock the new candidate policy with failing tests

**Files:** tests/candidates.test.ts, tests/pipeline.test.ts, tests/report.test.ts

- [ ] Step 1: Update the candidate unit test to expect a formal model candidate.

In tests/candidates.test.ts, keep the direct manual comparison and require the model demand to be formal with only the Trends check missing:

~~~typescript
expect(result.formal).toEqual(expect.arrayContaining([
  expect.objectContaining({
    sourceType: "model-catalog",
    evidenceOrigin: "capability_derived",
    lane: "formal",
    missingFields: ["Google Trends 7d"],
  }),
]));
expect(result.backup).not.toEqual(expect.arrayContaining([
  expect.objectContaining({ sourceType: "model-catalog" }),
]));
~~~

- [ ] Step 2: Run the focused test and verify the expected RED failure.

Run:

~~~bash
pnpm exec vitest run tests/candidates.test.ts -t "keeps model-catalog capability evidence"
~~~

Expected: FAIL because candidateForDemand currently excludes model-catalog plus capability_derived from the formal lane and asks for external demand evidence.

- [ ] Step 3: Update the pipeline test expectations.

In tests/pipeline.test.ts, require one formal and zero backup model candidates:

~~~typescript
expect(result.summary).toMatchObject({
  modelInventoryCount: 1,
  capabilityCount: 1,
  modelKeywordCount: 1,
  modelWatchDemandCount: 0,
  modelFormalDemandCount: 1,
});
expect(result.candidates?.formal).toEqual(expect.arrayContaining([
  expect.objectContaining({
    sourceType: "model-catalog",
    evidenceOrigin: "capability_derived",
  }),
]));
expect(result.candidates?.backup.some((item) => item.sourceType === "model-catalog")).toBe(false);
~~~

- [ ] Step 4: Update the report fixture expectations.

In tests/report.test.ts, require the model mapping and combination lines to say “待 Google Trends 验证” and reject the old wording:

~~~typescript
expect(report).toContain("产品能力推导：image to video · 待 Google Trends 验证");
expect(report).toContain("组合假设：product photo video with voiceover · image-to-video -> text-to-speech · 待 Google Trends 验证");
expect(report).not.toContain("待外部需求证据");
~~~

- [ ] Step 5: Run the three tests and verify they fail only on the old policy.

Run:

~~~bash
pnpm exec vitest run tests/candidates.test.ts tests/pipeline.test.ts tests/report.test.ts
~~~

Expected: candidate/pipeline assertions fail on formal versus backup placement and report assertions fail on the old external-evidence label; unrelated assertions remain green.

### Task 2: Promote concrete model-derived queries

**Files:** src/domain/candidates.ts, tests/candidates.test.ts

- [ ] Step 1: Remove the model-only formal exclusion.

In candidateForDemand, retain modelCatalogOnly for wording, but calculate formal without excluding it:

~~~typescript
const modelCatalogOnly = signal.sourceType === "model-catalog"
  && demand.origin === "capability_derived";
const formal = demand.qualityState !== "rejected"
  && precision !== "inferred"
  && !broadCapability
  && decision !== "false_positive";
~~~

This makes the existing semantic model mappings and combination demands formal verification candidates while preserving the broad-capability and inferred-precision guards.

- [ ] Step 2: Make model candidates require only the Trends check.

Use this branch before the existing non-model missing-field logic:

~~~typescript
const missingFields = modelCatalogOnly
  ? formal ? ["Google Trends 7d"] : ["验证真实搜索表达", "Google Trends 7d"]
  : formal
    ? ["Google Trends 7d", "SERP/供给", ...(demand.origin === "capability_derived" ? ["用户原话/替代诉求待确认"] : ["用户/商业证据"])]
    : broadCapability
      ? ["验证真实搜索表达", "Google Trends 7d", "用户原话/替代诉求待确认"]
      : ["验证真实搜索表达", "Google Trends 7d", "用户/商业证据"];
~~~

Change the model-only reason and qualification reason to “模型能力推导，优先验证 Google Trends 过去 7 天增速”. Do not change source URL, evidence quote, evidenceOrigin, or evidenceTransformation.

- [ ] Step 3: Run the candidate test and verify GREEN.

Run:

~~~bash
pnpm exec vitest run tests/candidates.test.ts -t "keeps model-catalog capability evidence"
~~~

Expected: PASS. The direct manual demand remains formal, and the model-derived demand is formal with a distinct candidate ID.

### Task 3: Align the model radar report

**Files:** src/report/markdown.ts, tests/pipeline.test.ts, tests/report.test.ts

- [ ] Step 1: Replace model mapping and combination status labels.

In modelRadarLines, use these two output forms:

~~~typescript
lines.push("产品能力推导：" + mapping.keyword + " · 待 Google Trends 验证" + (url ? " · [模型原文](" + url + ")" : ""));
lines.push("组合假设：" + combination.combinedQuery + " · " + combination.capabilityChain.join(" -> ") + " · 待 Google Trends 验证" + (model ? " · [模型原文](" + model.modelUrl + ")" : ""));
~~~

Preserve the existing Markdown bullet prefix and the compact five-mapping/three-combination limits. Do not show model-derived evidence as 用户原话.

- [ ] Step 2: Run focused tests after the report change.

Run:

~~~bash
pnpm exec vitest run tests/candidates.test.ts tests/pipeline.test.ts tests/report.test.ts
~~~

Expected: all focused tests pass; model candidates appear under 今天先查这 10 个词 and the old external-evidence phrase is absent.

### Task 4: Recover concrete capabilities from live catalog descriptions

**Files:** src/domain/model-capabilities.ts, tests/domain/model-capabilities.test.ts

- [ ] Step 1: Add a failing test for concrete description signals.

Use model records whose descriptions mirror the public catalog observations and assert that the normalizer emits concrete capabilities and task queries:

~~~typescript
const result = buildModelCapabilities([
  model({ modelName: "fal/seedream-edit", description: "Region-precise image editing changes one element while keeping the rest of the frame intact with layer separation and up to 10 reference images.", claimedCapabilities: ["edit"] }),
  model({ modelName: "fal/gpt-image", description: "Creates extremely detailed images with fine typography.", claimedCapabilities: ["gpt-image-2"] }),
  model({ modelName: "fal/birefnet", description: "High-resolution image segmentation for dichotomous image segmentation.", claimedCapabilities: ["v2"] }),
  model({ modelName: "hf/deepfake", claimedCapabilities: ["deepfake-detection"] }),
]);

expect(result.mappings.map((item) => item.keyword)).toEqual(expect.arrayContaining([
  "region specific image editing",
  "multi reference image editing",
  "layer aware image editing",
  "image generator with text",
  "image segmentation",
  "deepfake detection",
]));
expect(result.mappings.some((item) => item.keyword === "edit" || item.keyword === "v2")).toBe(false);
~~~

- [ ] Step 2: Run the capability test and verify the expected RED failure.

Run:

~~~bash
pnpm exec vitest run tests/domain/model-capabilities.test.ts -t "recovers concrete"
~~~

Expected: FAIL because the current rule table recognizes only the existing small capability set and treats edit/v2 as unsupported labels.

- [ ] Step 3: Extend the fixed capability rule table.

Add only concrete, task-shaped labels and mappings for image editing, region-specific editing, multi-reference editing, layer-aware editing, sequential editing, style transfer, text rendering, image segmentation, image classification, and deepfake detection. Detect these from normalized model descriptions, claimed capabilities, tags, and known pipeline labels. Keep opaque model names and generic labels out.

The new query mappings must be deterministic:

~~~typescript
"region-specific-image-editing": "region specific image editing"
"multi-reference-image-editing": "multi reference image editing"
"layer-aware-image-editing": "layer aware image editing"
"text-rendering": "image generator with text"
"image-segmentation": "image segmentation"
"deepfake-detection": "deepfake detection"
~~~

Description rules must require the matching concrete phrase, such as region-precise or changing one element for region editing, reference images for multi-reference editing, layer separation for layer-aware editing, typography/text rendering for text rendering, and segmentation for image segmentation.

- [ ] Step 4: Run the capability test and confirm GREEN.

Run:

~~~bash
pnpm exec vitest run tests/domain/model-capabilities.test.ts
~~~

Expected: all capability tests pass, every mapping retains at least one model URL, and no model name or opaque tag becomes a query.

### Task 5: Validate real output and land the change

**Files:** inspect data/runs/2026-09-03/report.md and model projections; do not add generated artifacts to git.

- [ ] Step 1: Run the full test suite, build, and whitespace checks.

Run:

~~~bash
pnpm test
pnpm build
git diff --check
~~~

Expected: all tests pass, TypeScript exits 0, and no whitespace errors are reported.

- [ ] Step 2: Run the public model source once.

Run:

~~~bash
RADAR_ENABLE_PUBLIC_HTTP=1 NODE_ENV=production pnpm radar -- --date 2026-09-03 --sources model-catalog --workspace /Users/huchenhao/code/website/github/trend-word-2
~~~

Record exit code and report path. Confirm the report has no external-evidence wording, capability-derived terms can appear in the main Trends queue, the queue has at most 10 items, and every model candidate has a model URL. Do not retry a provider 429.

- [ ] Step 3: Review the diff and preserve unrelated files.

Run:

~~~bash
git status --short --branch
git diff --stat
git diff --check
~~~

Stage only this plan, src/domain/candidates.ts, src/report/markdown.ts, tests/candidates.test.ts, tests/pipeline.test.ts, and tests/report.test.ts. Leave memory/ untouched.

- [ ] Step 4: Commit and push the scoped implementation.

Run:

~~~bash
git add docs/superpowers/plans/2026-09-03-model-capability-trends-candidates.md src/domain/candidates.ts src/report/markdown.ts tests/candidates.test.ts tests/pipeline.test.ts tests/report.test.ts
git diff --cached --check
git commit -m "feat: promote model capabilities to trends candidates"
git push origin codex/entity-demand-expression
~~~

After pushing, verify git status and the remote commit separately. Never force-push or modify provider credentials.
