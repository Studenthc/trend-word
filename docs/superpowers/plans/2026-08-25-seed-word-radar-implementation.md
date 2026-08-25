# Seed Word Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current title/body candidate extractor into a seed-word and expression-cluster radar that preserves source evidence, identifies concrete user language, and outputs no more than ten useful Google Trends verification candidates.

**Architecture:** Keep `RawSignal` immutable and add a pure discovery layer that extracts typed `SeedTerm` records from signal title, body, excerpt, tags, and structured source metadata. Normalize and cluster those terms before candidate scoring; keep Google Trends as a post-discovery manual link, and render the evidence needed for the user to verify it. Existing source adapters remain source-only and continue to report health independently.

**Tech Stack:** TypeScript ESM, Zod, Vitest, pnpm, JSON/JSONL local projections, Markdown reports.

---

## Scope and file map

| File | Responsibility |
| --- | --- |
| `src/types.ts` | Add validated seed-term, expression-cluster, and candidate evidence shapes without storing secrets. |
| `src/domain/seed-terms.ts` | Extract concrete expressions from source content, source tags, and source-specific metadata. |
| `src/domain/expression-clusters.ts` | Normalize aliases, classify term kind, group related terms, and calculate discovery freshness. |
| `src/domain/candidates.ts` | Score clusters rather than whole articles; keep formal candidates under ten and preserve backup reasons. |
| `src/domain/dedupe.ts` | Merge extracted seed terms into historical `Expression` records instead of using full article text as the expression. |
| `src/index.ts` | Wire seed extraction, cluster projections, evidence generation, and candidate construction into the run. |
| `src/report/markdown.ts` | Render a short report with candidate term, user language, source evidence, source diversity, and explicit missing checks. |
| `src/storage/run-store.ts` | Persist `seed-terms.json` and `expression-clusters.json` alongside existing projections. |
| `tests/seed-terms.test.ts` | Test extraction from SCYS-style prose, quotes, comments, product names, hashtags, and noise. |
| `tests/expression-clusters.test.ts` | Test normalization, aliases, cluster grouping, freshness, and cross-source counts. |
| `tests/candidates.test.ts` | Update candidate tests for cluster-based terms and ensure title-only records remain backup-only. |
| `tests/report.test.ts` | Verify the short evidence-first report and ten-item cap. |
| `tests/pipeline.test.ts` | Verify end-to-end projections and stable rebuild behavior. |
| `README.md` | Document the new discovery/verification distinction and local command outputs. |

The existing browser runtime and source adapters remain unchanged unless a failing integration test proves that a field needed by the extractor is not available. No undocumented Google Trends API, cookie access, automatic publishing, domain purchase, or external message sending is added.

## Data contracts

Add these types to `src/types.ts` and validate them with Zod:

```ts
export type SeedTermKind = "search_term" | "product" | "model" | "feature" | "concept" | "problem" | "play";
export type SeedTermLocation = "title" | "body" | "excerpt" | "tag" | "metadata";

export type SeedTerm = {
  id: string;
  rawSignalId: string;
  text: string;
  normalizedText: string;
  kind: SeedTermKind;
  location: SeedTermLocation;
  quote: string;
  extractionReason: string;
  firstSeenAt: string;
  sourceType: SourceType;
};

export type ExpressionCluster = {
  id: string;
  primaryTerm: string;
  normalizedTerms: string[];
  aliases: string[];
  kinds: SeedTermKind[];
  seedTermIds: string[];
  rawSignalIds: string[];
  sourceTypes: SourceType[];
  independentAuthors: number;
  independentCommunities: number;
  firstSeenAt: string;
  lastSeenAt: string;
  freshness: "new" | "rising" | "watch" | "stale";
};
```

`SeedTerm` is the discovery artifact. `Expression` remains the historical normalized projection. `ExpressionCluster` is the report/candidate grouping. The cluster must never invent a term that is not present in at least one `SeedTerm`.

## Task 1: Add seed-term extraction with tests

**Files:**
- Create: `src/domain/seed-terms.ts`
- Modify: `src/types.ts`
- Create: `tests/seed-terms.test.ts`

- [ ] **Step 1: Write failing extraction tests**

Add tests with these fixtures and assertions:

```ts
it("extracts quoted concepts, concrete search phrases, and a user problem from SCYS prose", () => {
  const signal = signalFixture({
    title: "AI 圈新词：wan animate 与工作流机会",
    body: "评论区有人问‘有没有演唱会调色修图工具’，作者提到“wan animate”，并描述保存失败、尺寸不对。",
  });
  const terms = extractSeedTerms(signal);
  expect(terms.map((item) => item.text)).toEqual(expect.arrayContaining(["wan animate", "演唱会调色修图", "保存失败", "尺寸不对"]));
  expect(terms.find((item) => item.text === "演唱会调色修图")?.location).toBe("body");
});

it("extracts product and repository expressions without treating the entire title as a term", () => {
  const signal = signalFixture({ sourceType: "github", title: "acme/flowpilot", body: "Workflow automation for teams." });
  const terms = extractSeedTerms(signal);
  expect(terms.map((item) => item.text)).toContain("flowpilot");
  expect(terms.map((item) => item.text)).not.toContain("acme/flowpilot");
});

it("rejects generic source noise and keeps a bounded quote", () => {
  const signal = signalFixture({ title: "AI 风向标：新玩法", body: "AI、出海、赚钱、创业。" });
  expect(extractSeedTerms(signal)).toEqual([]);
});
```

The test fixture must construct a complete `RawSignal` with `evidenceStatus: "verified"`, a stable URL, author, source type, and fetched timestamp. Keep the fixture in the test file so the extractor has no production dependency on test data.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm test -- tests/seed-terms.test.ts`

Expected: FAIL because `extractSeedTerms` and `SeedTerm` do not exist.

- [ ] **Step 3: Implement the minimal pure extractor**

Export `extractSeedTerms(signal: RawSignal): SeedTerm[]` and implement these ordered rules:

1. Skip failed signals and empty fields.
2. Read title, excerpt, body, tags, then GitHub/Product Hunt metadata in that order.
3. Extract bounded quoted spans from `「」`, `“”`, `""`, `《》`, backticks, hashtags, and Chinese/English phrase patterns around `工具`, `小程序`, `生成器`, `修图`, `记账`, `翻译器`, `generator`, `tool`, `app`, `game`, `workflow`, `model`, `skill`.
4. Extract problem phrases immediately around `求`, `需要`, `怎么`, `无法`, `打不开`, `保存不了`, `尺寸不对`, `太贵`, `卡顿`, `失败`, `找不到`.
5. Derive GitHub repository basename and Product Hunt title as `product` only when the value is not a generic collection, tutorial, or platform name.
6. Normalize whitespace and punctuation, discard terms shorter than two characters or longer than forty characters, discard generic terms such as `AI`, `工具`, `新玩法`, `风口`, `需求`, `出海`, `赚钱`, and deduplicate by normalized text plus location.
7. Store the original short sentence/phrase in `quote`; never use an AI-generated paraphrase as evidence.

Use these signatures:

```ts
export function extractSeedTerms(signal: RawSignal): SeedTerm[];
export function classifySeedTerm(text: string, quote: string): SeedTermKind;
export function isDiscoveryNoise(text: string): boolean;
```

- [ ] **Step 4: Run focused tests and build**

Run: `pnpm test -- tests/seed-terms.test.ts && pnpm build`

Expected: all seed-term tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit the extraction boundary**

Run:

```bash
git add src/types.ts src/domain/seed-terms.ts tests/seed-terms.test.ts
git commit -m "feat: extract auditable seed terms from source signals"
```

## Task 2: Cluster terms and repair historical expression merging

**Files:**
- Create: `src/domain/expression-clusters.ts`
- Modify: `src/domain/dedupe.ts`
- Modify: `src/types.ts`
- Create: `tests/expression-clusters.test.ts`
- Modify: `tests/dedupe.test.ts`

- [ ] **Step 1: Write failing cluster and merge tests**

Add tests for these behaviors:

```ts
it("groups spelling variants while retaining the first observed user wording", () => {
  const seeds = [seed("AI feet generator", "one"), seed("feet generator ai", "two")];
  const clusters = clusterSeedTerms(seeds, [signalFixture({ id: "one" }), signalFixture({ id: "two", sourceType: "github" })], "2026-08-25T00:00:00.000Z");
  expect(clusters).toHaveLength(1);
  expect(clusters[0]).toMatchObject({ primaryTerm: "AI feet generator", aliases: ["feet generator ai"] });
  expect(clusters[0]?.sourceTypes).toEqual(expect.arrayContaining(["scys-mcp", "github"]));
});

it("does not merge unrelated scene terms merely because they share AI", () => {
  const seeds = [seed("演唱会调色修图", "one"), seed("追星记账", "two")];
  expect(clusterSeedTerms(seeds, [signalFixture({ id: "one" }), signalFixture({ id: "two" })], "2026-08-25T00:00:00.000Z")).toHaveLength(2);
});

it("uses extracted seed terms when building historical expressions", () => {
  const expressions = mergeExpressions([signalFixture({ title: "AI 工作流案例", body: "评论里有人要 AI 工作流模板。" })], [], { status: "available", coverageAvailable: true });
  expect(expressions.map((item) => item.text)).not.toContain("AI 工作流案例");
  expect(expressions.map((item) => item.text)).toContain("AI 工作流模板");
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm test -- tests/expression-clusters.test.ts tests/dedupe.test.ts`

Expected: FAIL because clustering is not implemented and `mergeExpressions` still normalizes the entire first text field.

- [ ] **Step 3: Implement deterministic clustering**

Export:

```ts
export function clusterSeedTerms(seeds: SeedTerm[], signals: RawSignal[], now: string): ExpressionCluster[];
export function seedTermKey(text: string): string;
```

Cluster only when one of these deterministic conditions holds:

- normalized keys are equal;
- one normalized key is an English token-order variant of the other and both contain the same non-generic tokens;
- one term is an explicit alias from the same signal and the quote makes the relationship visible.

Do not use fuzzy similarity for Chinese terms. For each cluster, compute source types, author/community counts, first/last timestamps, aliases, and freshness: `new` for first seen within seven days, `rising` when there are multiple independent observations within seven days, `watch` otherwise, and `stale` when last seen is older than thirty days.

- [ ] **Step 4: Replace full-signal expression merging**

Change `mergeExpressions` to call `extractSeedTerms` for each non-failed signal, convert each `SeedTerm` into a small synthetic raw observation for the existing `Expression` projection, and preserve the original raw signal id in `Occurrence`. Existing historical expressions with no new seeds must remain in the projection with their previous lifecycle. Do not delete old history because a source is unavailable.

- [ ] **Step 5: Run tests and build**

Run: `pnpm test -- tests/expression-clusters.test.ts tests/dedupe.test.ts tests/lifecycle.test.ts && pnpm build`

Expected: all focused tests pass and existing lifecycle behavior remains unchanged.

- [ ] **Step 6: Commit the cluster boundary**

Run:

```bash
git add src/types.ts src/domain/expression-clusters.ts src/domain/dedupe.ts tests/expression-clusters.test.ts tests/dedupe.test.ts
git commit -m "feat: cluster seed expressions and rebuild history from terms"
```

## Task 3: Score clusters and preserve discovery evidence

**Files:**
- Modify: `src/domain/candidates.ts`
- Modify: `src/types.ts`
- Modify: `tests/candidates.test.ts`

- [ ] **Step 1: Write failing candidate tests**

Add tests that prove:

```ts
it("creates one candidate per expression cluster and cites the user-language quote", () => {
  const result = buildCandidateQueue([signalFixture({ title: "AI 新需求", body: "评论区有人问：有没有演唱会调色修图工具？保存还经常失败。" })], { now: "2026-08-25T00:00:00.000Z" });
  expect(result.formal).toEqual(expect.arrayContaining([expect.objectContaining({ term: "演唱会调色修图工具", reason: expect.stringContaining("用户表达") })]));
  expect(result.formal[0]?.context.length).toBeLessThanOrEqual(220);
});

it("prefers repeated concrete terms over generic hot titles", () => {
  const result = buildCandidateQueue([
    signalFixture({ id: "generic", title: "AI 风口来了", body: "AI、赚钱、创业" }),
    signalFixture({ id: "specific", title: "用户需求", body: "大家都在问追星记账小程序，想记录门票和周边开销。" }),
  ], { now: "2026-08-25T00:00:00.000Z" });
  expect(result.formal.map((item) => item.term)).toContain("追星记账");
  expect(result.formal.map((item) => item.term)).not.toContain("AI");
});

it("caps the report queue at ten and keeps source diversity", () => {
  const result = buildCandidateQueue(makeManySpecificSignals(), { maxFormal: 10 });
  expect(result.formal).toHaveLength(10);
  expect(new Set(result.formal.map((item) => item.sourceType)).size).toBeGreaterThan(1);
});
```

- [ ] **Step 2: Run focused candidate tests and verify the new tests fail**

Run: `pnpm test -- tests/candidates.test.ts`

Expected: the new cluster/evidence assertions fail against the current title/body extractor.

- [ ] **Step 3: Change candidate construction to consume clusters**

Add `clusters?: ExpressionCluster[]` and `seedTerms?: SeedTerm[]` to `CandidateQueueOptions`. `buildCandidateQueue` must:

1. Extract and cluster terms when callers do not provide them.
2. Create at most one candidate per cluster.
3. Score freshness, independent source types, independent authors, concrete problem language, and source engagement; generic title-only terms receive no formal score.
4. Use a compact evidence context built from the best quote plus one surrounding sentence, capped at 220 characters.
5. Set `reason` to a factual explanation such as `用户在评论/正文中提出具体场景；首次发现于...；来源...` and never claim Google Trends is rising unless a verified snapshot is supplied.
6. Put unresolved clusters in `backup` with explicit missing fields: `Google Trends 7d`, `SERP/供给`, `用户/商业证据`, or `正文/评论证据`.

Keep `trendsUrl` as a manual seven-day link. The candidate type should add `clusterId`, `evidenceQuote`, `freshness`, and `sourceCount` so the report can explain why it appeared.

- [ ] **Step 4: Run all domain tests and build**

Run: `pnpm test -- tests/candidates.test.ts tests/qualification.test.ts tests/feedback.test.ts && pnpm build`

Expected: all focused tests pass; existing skip/false-positive feedback still removes candidates by stable `candidateId`.

- [ ] **Step 5: Commit candidate scoring**

Run:

```bash
git add src/types.ts src/domain/candidates.ts tests/candidates.test.ts
git commit -m "feat: score expression clusters for daily verification"
```

## Task 4: Wire projections and evidence-first report output

**Files:**
- Modify: `src/index.ts`
- Modify: `src/storage/run-store.ts`
- Modify: `src/report/markdown.ts`
- Modify: `tests/pipeline.test.ts`
- Modify: `tests/report.test.ts`

- [ ] **Step 1: Write failing pipeline/report tests**

Extend the fixture run test:

```ts
it("persists seed terms and clusters and reports the evidence before the Trends link", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "seed-radar-"));
  const result = await runRadar({ date: "2026-08-25", sourceNames: ["fixtures"], workspaceRoot });
  const files = await readdir(path.join(workspaceRoot, "data", "runs", "2026-08-25"));
  expect(files).toEqual(expect.arrayContaining(["seed-terms.json", "expression-clusters.json", "candidates.json"]));
  expect(result.report).toContain("用户表达");
  expect(result.report.indexOf("用户表达")).toBeLessThan(result.report.indexOf("查 Trends"));
  expect(result.report.length).toBeLessThan(2800);
});
```

Add a report fixture with two sources and verify the report contains source names, author/date, a bounded quote, `Google Trends 尚未自动验证`, and missing checks. Verify it does not dump the full source body or repeat the same term more than once in the formal section.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm test -- tests/pipeline.test.ts tests/report.test.ts`

Expected: FAIL because the new projections and evidence-first report sections do not exist.

- [ ] **Step 3: Wire the run pipeline**

In `runRadarInternal`:

1. Extract `SeedTerm[]` from deduped non-failed signals.
2. Build `ExpressionCluster[]` once using the run timestamp.
3. Pass both into `buildCandidateQueue`.
4. Generate `Evidence` from each seed term using its exact `quote`, `location`, source signal id, capture time, and grade derived from `RawSignal.evidenceStatus`.
5. Persist `seed-terms.json` and `expression-clusters.json` through `RunStore` without changing append-only raw signal behavior.
6. Keep opportunity qualification conservative; discovery terms do not become `actionable` without the existing trend, competition, delivery, and evidence gates.

Add `writeProjection("seed-terms", seedTerms)` and `writeProjection("expression-clusters", clusters)` to the existing run directory. Add their paths to the report's data-location section.

- [ ] **Step 4: Replace the long one-line candidate report**

Render each formal candidate as a compact four-line block:

```md
### 1. 演唱会调色修图工具
- 为什么出现：用户评论/正文提出具体场景；近 7 天首次发现；2 个来源
- 用户原话：「有没有演唱会调色修图工具？」
- 来源：作者 · 2026-08-25 · SCYS
- 验证：查 Google Trends 过去 7 天 · 缺少 SERP/供给证据
```

Render backup candidates under `## 新发现但证据不足`, capped at ten, and show the exact missing field. Keep source health and data paths after the candidate sections. Do not include raw full bodies in Markdown.

- [ ] **Step 5: Run tests and build**

Run: `pnpm test -- tests/pipeline.test.ts tests/report.test.ts && pnpm build && git diff --check`

Expected: focused tests pass, TypeScript exits 0, and the diff has no whitespace errors.

- [ ] **Step 6: Commit the pipeline and report**

Run:

```bash
git add src/index.ts src/storage/run-store.ts src/report/markdown.ts tests/pipeline.test.ts tests/report.test.ts
git commit -m "feat: persist seed discovery and render evidence-first reports"
```

## Task 5: Verify source-specific discovery and documentation

**Files:**
- Modify: `tests/sources/scys-browser-runtime.test.ts`
- Modify: `tests/sources/github.test.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-25-scys-browser-daily-radar-design.md` only if the runtime field contract changed

- [ ] **Step 1: Add source regression fixtures**

Add one SCYS browser fixture with a title-only card and one detail record containing a comment-style problem phrase. Assert the browser normalizer keeps `evidenceStatus: "partial"` when detail is unavailable and exposes the full body when detail is available. Add one GitHub fixture with a repository name, README excerpt, and generic collection repository; assert only the concrete repository becomes a seed term.

- [ ] **Step 2: Run source tests**

Run: `pnpm test -- tests/sources/scys-browser-runtime.test.ts tests/sources/github.test.ts`

Expected: all source tests pass without requiring browser authentication or network access.

- [ ] **Step 3: Document the new report contract**

Update `README.md` to state:

- source collection produces immutable raw signals;
- seed terms are extracted from user language, products, models, features, problems, and plays;
- expression clusters prevent repeated aliases from occupying the ten-item daily list;
- Google Trends is a manual seven-day verification link in this phase;
- source failure is not treated as an empty source;
- useful artifacts are `seed-terms.json`, `expression-clusters.json`, `candidates.json`, and `report.md`.

- [ ] **Step 4: Run the full local validation**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: all deterministic tests pass, TypeScript exits 0, and no whitespace errors are reported. If the pre-existing time-sensitive Google Trends qualification test fails, record the exact test and preserve its existing boundary rather than weakening the assertion.

- [ ] **Step 5: Commit documentation and source regressions**

Run:

```bash
git add README.md tests/sources/scys-browser-runtime.test.ts tests/sources/github.test.ts docs/superpowers/specs/2026-08-25-scys-browser-daily-radar-design.md
git commit -m "docs: describe seed-word radar evidence workflow"
```

## Task 6: Run a real fixture-backed daily report and review output

**Files:**
- No source changes unless a verified regression is found.
- Generated local artifacts: `data/runs/YYYY-MM-DD/` and `reports/YYYY-MM-DD.md`.

- [ ] **Step 1: Run the deterministic daily radar**

Run: `pnpm radar -- --date 2026-08-25 --sources fixtures`

Expected: exit 0, write the new seed and cluster projections, and print or produce a report with no more than ten formal candidates.

- [ ] **Step 2: Inspect the report and projections**

Check:

```bash
wc -c reports/2026-08-25.md
node -e 'const fs=require("node:fs"); const p="data/runs/2026-08-25"; for (const f of ["seed-terms.json","expression-clusters.json","candidates.json","run-summary.json"]) console.log(f, JSON.parse(fs.readFileSync(`${p}/${f}`,"utf8")).length ?? "object")'
```

Expected: report under 2800 characters, formal queue <= 10, each formal candidate has a quote and source URL, and no candidate is derived solely from a generic title.

- [ ] **Step 3: Re-run to check deterministic rebuild behavior**

Run: `pnpm radar -- --date 2026-08-25 --sources fixtures` again and compare the JSON projections with `git diff -- data/runs/2026-08-25 reports/2026-08-25.md`.

Expected: rebuilding the same date does not duplicate raw signals or change term/cluster ids.

- [ ] **Step 4: Report remaining risks**

Record in the final handoff whether real SCYS detail expansion was available, whether Google Trends was manually verified, and which source health states were observed. Do not call a candidate commercially validated solely because it appeared in a source article.

## Self-review checklist

- The plan covers the spec's discovery/verification separation, evidence provenance, source-health boundaries, ten-item output limit, and local persistence.
- No task uses title text as a substitute for a discovered expression.
- All new functions have explicit names and signatures before they are used.
- Every changed behavior has a focused failing test before implementation.
- The plan does not add a paid API, undocumented endpoint, browser credential access, or external side effect.
- The only remaining human judgment is the intended one: Google Trends/SERP and commercial fit are shown as verification work, not fabricated by the radar.

## Execution status

- [x] Seed-term extraction, typed validation, and focused tests.
- [x] Expression clustering, alias handling, Product Hunt repost merging, and historical expression repair.
- [x] Cluster-based candidate scoring, source diversity, feedback compatibility, and ten-item cap.
- [x] Seed-term/cluster/evidence projections and compact evidence-first Markdown report.
- [x] README update and source regression coverage preserved.
- [x] Full test suite, TypeScript build, whitespace check, real fixture run, and repeat-run verification.
