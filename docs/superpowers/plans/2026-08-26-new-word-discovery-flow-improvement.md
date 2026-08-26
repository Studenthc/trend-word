# New Word Discovery Flow Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax and are executed in order.

**Goal:** Turn the radar from a title/body phrase extractor into a recent-first discovery system that produces at most ten evidence-backed Google Trends verification tasks each day.

**Architecture:** Keep immutable `RawSignal` records and the current source-health boundary. Add a recent-first collection contract, extract natural-language candidate phrases from user language, compare current observations with historical expression frequency, and rank a small verification queue. Google Trends remains a manual post-discovery step, but its result is stored as a first-class verification record rather than only represented by a URL.

**Tech Stack:** TypeScript ESM, Zod, Vitest, pnpm, JSON/JSONL local projections, Markdown reports, existing Chrome SCYS runtime.

---

## Scope and file map

| File | Responsibility |
| --- | --- |
| `src/types.ts` | Add discovery evidence, freshness metrics, and manual Trends verification shapes. |
| `src/sources/scys-mcp.ts` | Preserve source adapter behavior while adding an explicit recent-content query contract and query metadata. |
| `scripts/scys-browser-runtime.mjs` | Read recent SCYS materials first, then run configured search queries; retain partial/detail failures honestly. |
| `src/domain/seed-terms.ts` | Extract quoted terms, problem phrases, product entities, and bounded noun phrases from ordinary prose without requiring quotation marks. |
| `src/domain/expression-clusters.ts` | Group only deterministic aliases and calculate recent occurrence counts. |
| `src/domain/dedupe.ts` | Keep historical expression observations and preserve current-vs-baseline counts. |
| `src/domain/candidates.ts` | Rank genuinely new/rising expressions using freshness, repetition, source diversity, user-language evidence, and engagement. |
| `src/report/markdown.ts` | Render a short “today’s verification list” with why-now evidence before links. |
| `src/report/summary.ts` | Include candidate counts and source coverage in the run summary. |
| `src/storage/run-store.ts` | Persist discovery metrics and manual verification records. |
| `src/cli.ts` | Add an explicit `verify` command for recording Trends observations. |
| `radar.config.json` | Define recent window, SCYS query strategy, and report limits. |
| `tests/seed-terms.test.ts` | Prove ordinary unquoted Chinese and English phrases are discovered and noise is rejected. |
| `tests/expression-clusters.test.ts` | Prove recent counts and deterministic alias grouping. |
| `tests/candidates.test.ts` | Prove new/rising terms outrank generic titles and remain capped at ten. |
| `tests/report.test.ts` | Prove the report is concise and tells the user why to check a term. |
| `tests/pipeline.test.ts` | Prove projections and verification records survive a full run. |
| `tests/sources/scys-browser-runtime.test.ts` | Prove recent-first browsing and partial-result semantics. |
| `README.md` | Document the real daily workflow and manual Trends verification command. |

## Non-goals

- Do not call an undocumented Google Trends API.
- Do not read or persist browser cookies, localStorage, tokens, or profiles.
- Do not make X global search or Reddit global search a hard dependency.
- Do not turn a single article title, repository name, or Product Hunt launch into an actionable opportunity without user-language or corroborating evidence.
- Do not redesign the whole storage layer or add a dashboard.

### Task 1: Lock the discovery and verification data contracts

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `radar.config.json`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add tests asserting that the config accepts `discovery.recentDays`, `discovery.maxSourcesPerQuery`, and `report.maxVerificationItems`, and that a `TrendVerification` record accepts `window: "7d"`, `result: "rising" | "flat" | "declining" | "breakout" | "no_data"`, `checkedAt`, and optional related queries.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm test -- tests/config.test.ts`

Expected: FAIL because the new config and verification schemas do not exist.

- [ ] **Step 3: Add the minimal contracts**

Add these fields and schemas:

```ts
export const trendVerificationSchema = z.object({
  candidateId: z.string(),
  provider: z.literal("google_trends_manual"),
  checkedAt: z.string(),
  window: z.literal("7d"),
  region: z.string(),
  result: z.enum(["rising", "flat", "declining", "breakout", "no_data"]),
  value: z.number().optional(),
  delta: z.number().optional(),
  relatedQueries: z.array(z.object({ text: z.string(), growth: z.number().optional(), type: z.enum(["top", "rising"]).optional() })),
  notes: z.string().optional(),
});
export type TrendVerification = z.infer<typeof trendVerificationSchema>;
```

Extend the config with `discovery: { recentDays: positive integer, maxSourcesPerQuery: positive integer }` and `report.maxVerificationItems: nonnegative integer`, defaulting to 7, 3, and 10. Keep `googleTrends.mode` as `manual-or-optional`.

- [ ] **Step 4: Run focused tests and build**

Run: `pnpm test -- tests/config.test.ts && pnpm build`

Expected: PASS and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/config.ts radar.config.json tests/config.test.ts
git commit -m "feat: define discovery freshness and trends verification contracts"
```

### Task 2: Make SCYS collection recent-first

**Files:**
- Modify: `scripts/scys-browser-runtime.mjs`
- Modify: `src/sources/scys-mcp.ts`
- Modify: `src/index.ts`
- Test: `tests/sources/scys-browser-runtime.test.ts`
- Test: `tests/report.test.ts`

- [ ] **Step 1: Write failing recent-first tests**

Add a browser-runtime fixture with three visible SCYS cards: one dated inside the seven-day window, one dated 20 days ago, and one undated. Assert that the transport returns the recent item first, marks the undated item `partial`, and never claims the old item is recent. Add a source query test asserting the adapter sends `publishedAfter` or equivalent recent-window metadata when the source supports it.

- [ ] **Step 2: Run focused tests and verify the new assertions fail**

Run: `pnpm test -- tests/sources/scys-browser-runtime.test.ts tests/report.test.ts`

Expected: FAIL because the browser bridge currently only searches configured words and does not sort/filter recent materials.

- [ ] **Step 3: Implement recent-first collection**

Change `createScysBrowserTransport` to accept `recentDays` and `maxSourcesPerQuery`. First inspect the visible materials list and normalize card dates. Sort by parsed date descending, keep up to the configured source limit, and only then execute configured searches as a supplemental pass. Union results by title and source URL. Preserve old records as valid historical signals when they are returned by a targeted query, but annotate them as outside the current discovery window.

Add `discoveryWindow` metadata to the source request/result path without putting secrets into `RawSignal`. `runRadar` must pass `config.discovery.recentDays` to the SCYS adapter/runtime. Keep failed detail reads as `partial` and keep browser-session errors as `blocked`/`unverified`, never as an empty success.

- [ ] **Step 4: Run focused tests and build**

Run: `pnpm test -- tests/sources/scys-browser-runtime.test.ts tests/sources/scys-mcp.test.ts tests/report.test.ts && pnpm build`

Expected: PASS. Source reports show recent counts separately from total raw counts.

- [ ] **Step 5: Commit**

```bash
git add scripts/scys-browser-runtime.mjs src/sources/scys-mcp.ts src/index.ts tests/sources/scys-browser-runtime.test.ts tests/report.test.ts
git commit -m "feat: collect recent SCYS material before keyword search"
```

### Task 3: Extract ordinary-language expressions

**Files:**
- Modify: `src/domain/seed-terms.ts`
- Modify: `src/domain/expression-clusters.ts`
- Modify: `src/domain/dedupe.ts`
- Test: `tests/seed-terms.test.ts`
- Test: `tests/expression-clusters.test.ts`
- Test: `tests/dedupe.test.ts`

- [ ] **Step 1: Write failing natural-language extraction tests**

Add fixtures proving these expressions are found from ordinary prose without quotes:

```ts
body: "最近大家开始做 AI 原生工作流，很多人还在讨论一人公司自动化。有人说陪跑式交付比卖模板更容易成交。"
```

Expected terms include `AI 原生工作流`, `一人公司自动化`, and `陪跑式交付`, with bounded sentence quotes. Also assert that `AI`, `大家`, `最近`, `工具`, and `新玩法` are rejected, and that a generic title does not become a seed term merely because it contains “AI”.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm test -- tests/seed-terms.test.ts tests/expression-clusters.test.ts tests/dedupe.test.ts`

Expected: FAIL because current extraction only recognizes markers and fixed suffix patterns.

- [ ] **Step 3: Implement bounded phrase extraction**

Add a deterministic extractor that splits body/excerpt into sentences, removes stopwords and generic source language, and collects 2-6 token spans around known semantic anchors such as `工作流`, `自动化`, `交付`, `带货`, `切片`, `知识库`, `代理`, `模型`, `小程序`, `生成器`, `修图`, `记账`, and their English equivalents. Keep only spans containing either a domain noun plus an action noun, a concrete problem, or a product/model token. Never emit the whole sentence. Keep quoted/hashtag/problem/product rules first so their evidence reason remains stronger.

Extend `SeedTerm` with `isNaturalLanguage: boolean` and `mentionCountInSignal: number`. Deduplicate by normalized text and location. In clustering, keep the first user wording as `primaryTerm`, group English token-order variants only when all non-generic tokens match, and never fuzzy-merge unrelated Chinese phrases.

In `mergeExpressions`, preserve every seed occurrence, including its raw signal ID and quote context. Existing history with no current seed remains in the projection.

- [ ] **Step 4: Run focused tests and build**

Run: `pnpm test -- tests/seed-terms.test.ts tests/expression-clusters.test.ts tests/dedupe.test.ts tests/lifecycle.test.ts && pnpm build`

Expected: PASS with old lifecycle behavior intact.

- [ ] **Step 5: Commit**

```bash
git add src/domain/seed-terms.ts src/domain/expression-clusters.ts src/domain/dedupe.ts tests/seed-terms.test.ts tests/expression-clusters.test.ts tests/dedupe.test.ts
git commit -m "feat: discover unquoted natural-language expressions"
```

### Task 4: Rank novelty and build the ten-item verification pool

**Files:**
- Modify: `src/domain/candidates.ts`
- Modify: `src/types.ts`
- Modify: `src/index.ts`
- Test: `tests/candidates.test.ts`
- Test: `tests/pipeline.test.ts`

- [ ] **Step 1: Write failing ranking tests**

Add current and historical signal fixtures proving:

```ts
// old generic title, high engagement
title: "AI 风口来了", body: "AI 工具推荐"
// recent repeated user language
body: "很多人开始讨论一人公司自动化，想找能直接落地的方案。"
```

Assert the latter ranks above the generic title. Add a term appearing in three recent signals and another appearing once; assert the repeated term has a higher `noveltyScore`. Add 14 valid terms from four sources and assert exactly 10 formal candidates with at least two source families when available.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm test -- tests/candidates.test.ts tests/pipeline.test.ts`

Expected: FAIL because current scoring is mostly term length plus fixed freshness and does not compare against historical frequency.

- [ ] **Step 3: Implement explicit novelty metrics**

Add to `RadarCandidate`:

```ts
noveltyScore: number;
whyNow: string[];
recentMentions: number;
baselineMentions: number;
```

Compute scores from bounded components: recent first-seen `+35`, recent mention delta `+0..30`, independent authors `+0..15`, independent source families `+0..15`, concrete user problem `+10`, engagement `+0..10`, generic/noise penalty `-40`. Use historical `Expression.occurrences` as the baseline and current signals as the recent window. A single title-only repository/product entity goes to backup unless it also has a concrete description and recent evidence.

Return formal candidates sorted by novelty, then source diversity, then stable term order. Apply the ten-item cap after diversity selection. Keep backup candidates for useful but incomplete signals with explicit missing checks. Never say a term is trending without a verified `TrendVerification` record.

- [ ] **Step 4: Persist and test the metrics**

Persist the candidate queue, novelty fields, and discovery summary in the daily run. Add an end-to-end assertion that the JSON projections contain `recentMentions`, `baselineMentions`, and `whyNow`.

- [ ] **Step 5: Run focused tests and build**

Run: `pnpm test -- tests/candidates.test.ts tests/pipeline.test.ts tests/qualification.test.ts && pnpm build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/candidates.ts src/types.ts src/index.ts tests/candidates.test.ts tests/pipeline.test.ts
git commit -m "feat: rank genuinely new expressions for Trends verification"
```

### Task 5: Make manual Google Trends verification a real workflow

**Files:**
- Modify: `src/storage/run-store.ts`
- Modify: `src/cli.ts`
- Modify: `src/report/markdown.ts`
- Modify: `src/report/summary.ts`
- Test: `tests/report.test.ts`
- Test: `tests/storage.test.ts`

- [ ] **Step 1: Write failing report and CLI tests**

Add a test that renders no more than ten candidates and includes, in this order, the term, `为什么现在`, user quote, source/date, `查 Google Trends 7d`, and missing checks. Add a CLI test for:

```bash
pnpm radar -- verify --candidate candidate-一人公司自动化 --result rising --region CN --note "过去7天明显上升"
```

Assert that the record is written under the corresponding run directory and can be read back.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm test -- tests/report.test.ts tests/storage.test.ts`

Expected: FAIL because there is no verification command or persisted verification projection.

- [ ] **Step 3: Implement the verification command and concise report**

Add `TrendVerification[]` persistence at `data/runs/YYYY-MM-DD/trend-verifications.json`. The command must require candidate ID, result, region, and optional note/related queries; it must reject candidate IDs not present in that run. Update the matching candidate’s validation state to `rising`, `declining`, or `event_spike` when the result is `rising`, `declining`, or `breakout`; keep `no_data` as unknown and retain the candidate.

Render the report as:

```text
## 今天先查这 10 个词
### 1. 一人公司自动化
- 为什么现在：7 天内首次出现；3 次提及；2 位作者；来自 SCYS、GitHub
- 用户原话：……
- 来源：作者 · 日期 · 原文
- 查 Google Trends：过去 7 天 · CN
- 尚缺：趋势、SERP/供给、用户/商业证据
```

Keep source health and data paths below the queue. Show a short backup section only when it contains terms not already in the formal queue. If there are no formal candidates, explain whether the cause is no recent source data, extraction failure, or missing detail evidence.

- [ ] **Step 4: Run tests and build**

Run: `pnpm test -- tests/report.test.ts tests/storage.test.ts tests/pipeline.test.ts && pnpm build`

Expected: PASS and report length stays below 3500 characters for ten candidates.

- [ ] **Step 5: Commit**

```bash
git add src/storage/run-store.ts src/cli.ts src/report/markdown.ts src/report/summary.ts tests/report.test.ts tests/storage.test.ts
git commit -m "feat: turn Trends checks into a persisted daily workflow"
```

### Task 6: Update daily runtime documentation and perform a real dry run

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-25-scys-browser-daily-radar-design.md`
- Create: `docs/decisions/2026-08-26-new-word-discovery-flow.md`
- Test: all existing tests

- [ ] **Step 1: Document the final flow**

Document that the daily task first reads recent SCYS materials, then performs targeted searches, extracts ordinary-language expressions, ranks at most ten candidates, and waits for manual Trends verification. State clearly that a successful run with zero candidates is only meaningful when SCYS source health is `available` and the recent material count is nonzero.

- [ ] **Step 2: Run the full validation suite**

Run: `pnpm test && pnpm build`

Expected: all tests pass and TypeScript exits 0.

- [ ] **Step 3: Run a fixture acceptance report**

Run: `pnpm radar -- --date 2026-08-26 --sources fixtures --workspace /tmp/new-word-radar-2026-08-26`

Expected: report is written, contains a maximum of ten verification candidates, includes `为什么现在`, and preserves source health plus manual Trends links.

- [ ] **Step 4: Run the configured no-credential dry run**

Run: `pnpm radar -- --date 2026-08-26 --workspace /tmp/new-word-radar-configured-2026-08-26`

Expected: unavailable transports are reported as `unverified`; no source failure is converted into an empty success and no credentials are written.

- [ ] **Step 5: Commit documentation and acceptance decision**

```bash
git add README.md docs/superpowers/specs/2026-08-25-scys-browser-daily-radar-design.md docs/decisions/2026-08-26-new-word-discovery-flow.md
git commit -m "docs: define the recent-first new word radar workflow"
```

## Self-review

- Source availability, recent-first collection, natural-language extraction, historical novelty, ten-item diversity cap, manual Trends verification, concise reporting, and daily acceptance are each covered by a task.
- No task introduces an unofficial Trends API, browser credential access, or social source that is unavailable in the current environment.
- Shared names are consistent: `TrendVerification`, `noveltyScore`, `whyNow`, `recentMentions`, `baselineMentions`, and `trend-verifications.json`.
- The plan keeps the existing immutable raw-signal and source-health boundaries and changes only discovery quality, ranking, verification persistence, and presentation.

## Verification commands

```bash
pnpm test
pnpm build
pnpm radar -- --date 2026-08-26 --sources fixtures --workspace /tmp/new-word-radar-2026-08-26
```
