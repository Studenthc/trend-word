# Google Trends No-Data Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Google Trends `no_data` an explicit early-signal observation state instead of treating it as evidence that a candidate has no demand.

**Architecture:** Keep Google Trends as a post-discovery confirmation layer. Persisted manual verification records will be attached to the daily candidate queue at report-render time; `no_data` will receive explanatory wording and a 48–72 hour recheck action, while only verified trend directions can affect qualification.

**Tech Stack:** TypeScript, Zod, Vitest, Markdown report renderer, existing JSON projection store.

---

### Task 1: Add verification state to report candidates

**Files:**
- Modify: `/Users/huchenhao/code/website/github/trend-word-2/src/domain/candidates.ts`
- Test: `/Users/huchenhao/code/website/github/trend-word-2/tests/report.test.ts`

- [x] **Step 1: Write the failing test**

Add a report fixture with `trendVerification: { result: "no_data" }` and assert the rendered candidate contains `暂无可见数据` and `不代表没人搜`, while a candidate without a record still renders `未验证`.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `pnpm vitest run tests/report.test.ts -t "renders no-data Trends verification as observation"`

Expected: FAIL because `RadarCandidate` cannot carry a verification record and the report has no no-data wording.

- [x] **Step 3: Implement the minimal type change**

Import `TrendVerification` into `src/domain/candidates.ts` and add this optional field to `RadarCandidate`:

```ts
trendVerification?: TrendVerification;
```

No change is needed to the Zod persistence schema because candidate queues are run artifacts rather than a validated domain projection.

- [x] **Step 4: Run the focused test again**

Run: `pnpm vitest run tests/report.test.ts -t "renders no-data Trends verification as observation"`

Expected: FAIL only on report wording, proving the type fixture is accepted and the renderer is the remaining behavior under test.

### Task 2: Attach the latest manual verification to the daily queue

**Files:**
- Modify: `/Users/huchenhao/code/website/github/trend-word-2/src/index.ts`
- Test: `/Users/huchenhao/code/website/github/trend-word-2/tests/report.test.ts`

- [x] **Step 1: Write the failing integration test**

Create a temporary run, write a `trend-verifications.json` projection containing a current `no_data` record for a known candidate, run the fixture radar, and assert the returned Markdown report includes the no-data observation wording.

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/report.test.ts -t "attaches the latest Trends verification"`

Expected: FAIL because `runRadar` currently never reads `trend-verifications.json` when rendering the report.

- [x] **Step 3: Implement the minimal attachment helper**

After building the candidate queue, read `trend-verifications` through `RunStore`, select the latest record for each `candidateId` by `checkedAt`, and pass cloned candidates with `trendVerification` attached to `renderMarkdownReport`. Return and write the attached view so the report artifact and `RadarRunResult.candidates` agree.

- [x] **Step 4: Run the focused integration test**

Run: `pnpm vitest run tests/report.test.ts -t "attaches the latest Trends verification"`

Expected: PASS.

### Task 3: Render explicit, non-negative Trends states and recheck action

**Files:**
- Modify: `/Users/huchenhao/code/website/github/trend-word-2/src/report/markdown.ts`
- Test: `/Users/huchenhao/code/website/github/trend-word-2/tests/report.test.ts`

- [x] **Step 1: Write the failing renderer assertions**

Assert these exact semantics:

```text
未验证：还没有人工核验结果
暂无可见数据：不代表没人搜；建议 48–72 小时后复查原词、词根和同义表达
上升/爆发/平稳/下降：显示人工核验结果和地区
```

Also assert the global reminder no longer says every candidate is simply “尚未自动验证” when at least one candidate has a manual record.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `pnpm vitest run tests/report.test.ts -t "renders no-data Trends verification as observation|renders verified Trends state"`

Expected: FAIL because candidate lines currently only show a Trends URL and the reminder is unconditional.

- [x] **Step 3: Implement the minimal renderer helpers**

Add a small `trendVerificationLine` helper. It must map `no_data` to neutral wording, map `breakout` to `爆发`, preserve `rising`, `flat`, and `declining`, include `region`, and omit numeric fields that were not recorded. Change the reminder to say that the queue is awaiting or using manual 7-day verification, and add the early-signal caveat when any current record is `no_data`.

- [x] **Step 4: Run focused report tests**

Run: `pnpm vitest run tests/report.test.ts`

Expected: PASS with the existing bounded-report, transformed-expression, inferred-expression, and readability assertions intact.

### Task 4: Verify the complete change

**Files:**
- No additional production files.

- [x] **Step 1: Run source-specific tests**

Run: `pnpm vitest run tests/report.test.ts tests/sources/google-trends.test.ts tests/qualification.test.ts`

Expected: PASS; `no_data` remains non-qualifying evidence and does not become a rejection signal.

- [x] **Step 2: Run the complete test suite**

Run: `pnpm test`

Expected: all tests pass.

- [x] **Step 3: Build and check the diff**

Run: `pnpm build` and `git diff --check`

Expected: build succeeds and diff check prints no errors.

- [x] **Step 4: Run a real report smoke test**

Run the existing 2026-08-31 source/input command and inspect `data/runs/2026-08-31/report.md`. Confirm the report still keeps the formal and observation queues bounded and does not claim a zero trend means zero demand.
