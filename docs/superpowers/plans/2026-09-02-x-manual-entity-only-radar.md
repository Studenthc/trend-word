# X Manual Entity-Only Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default daily radar use only Product Hunt/GitHub original product content plus manually curated X List signals, with no Product Hunt comment or GitHub Issue collection.

**Architecture:** Product Hunt and GitHub remain entity discovery sources and may enrich an entity with its official description or README. X is a manual source: the operator uses the authenticated Chrome session to curate the last 24 hours into `data/runs/YYYY-MM-DD/x-web-input.jsonl`; the CLI auto-detects that file when running with default options. Reddit, SCYS, and the X API adapter remain explicit opt-in sources.

**Tech Stack:** TypeScript, Zod, Vitest, pnpm, existing JSONL storage, Markdown reports, authenticated Chrome browser session.

---

## File map

- Modify `src/index.ts`: auto-detect the daily X manual file, make missing automatic input non-fatal, remove feedback enrichment from the run pipeline, and label manual coverage as X.
- Modify `src/config.ts` and `radar.config.json`: make Product Hunt and GitHub the only default network sources; leave optional adapters available for explicit runs.
- Modify `src/report/markdown.ts`: render manual coverage as `X（人工）` and show a precise missing-input note without feedback counters.
- Modify `src/types.ts`: keep optional legacy feedback fields so historical projections remain readable, but do not add new feedback records.
- Delete `src/sources/feedback.ts` and `tests/sources/feedback.test.ts`: remove the no-longer-used comment/Issue collector and its direct tests.
- Modify `tests/pipeline.test.ts`, `tests/report.test.ts`, `tests/config.test.ts`, and source-related tests: cover automatic X input, missing input, no comment/Issue requests, and opt-in source behavior.
- Modify `src/domain/seed-terms.ts` and `src/domain/candidates.ts` plus their tests: keep manually curated X titles as observations unless the body contains a qualifying demand expression, and report accurate missing fields.
- Modify `README.md`: document the authenticated Chrome X List SOP and default source boundary.
- Create `data/runs/YYYY-MM-DD/x-web-input.jsonl` during the daily browser collection step; never store cookies, tokens, or browser profile data.

## Task 1: Make default source selection include daily X manual input

**Files:**
- Modify: `src/index.ts`
- Modify: `src/config.ts`
- Modify: `radar.config.json`
- Test: `tests/report.test.ts`
- Test: `tests/config.test.ts`

- [x] **Step 1: Write failing tests for automatic X input selection.** Add one test that creates `data/runs/2026-09-02/x-web-input.jsonl`, calls `runRadar({ date: "2026-09-02", workspaceRoot, transports: ... })` without `sourceNames` or `inputPath`, and asserts `summary.sourcesAttempted` contains `manual`, the manual health is `available`, and the report says `X（人工）`. Add a second test with no file that asserts the default run remains `complete`, includes a manual health entry with `unverified`, and contains `当天人工输入缺失`.

```ts
const result = await runRadar({ date: "2026-09-02", workspaceRoot, adapters: stableAdapters });
expect(result.summary.sourcesAttempted).toContain("manual");
expect(result.report).toContain("X（人工）: available");
```

- [x] **Step 2: Run the focused tests and verify RED.** Run `pnpm exec vitest run tests/report.test.ts tests/config.test.ts -t "X|default"`. Expected failure: default runs do not include `manual`, and a missing manual input currently finalizes as a failed run.

- [x] **Step 3: Implement automatic input resolution.** In `runRadarInternal`, when `options.sourceNames` is absent, append `manual` to the configured default source list. Resolve the default input to `data/runs/${options.date}/x-web-input.jsonl`. Treat an absent automatic file as `manual: unverified` with `当天人工输入缺失` and continue; preserve the existing blocking error when a caller explicitly requests `--sources manual` without `--input`.

- [x] **Step 4: Restrict configured defaults.** Set `sources.bestEffort` and `sources.validation` to empty arrays while keeping their adapters/configuration available for explicit source selection. Keep Product Hunt and GitHub in `required`; keep `manual: true`. Disable X API in the default config because X is now manual.

- [x] **Step 5: Run the focused tests and verify GREEN.** Run `pnpm exec vitest run tests/report.test.ts tests/config.test.ts -t "X|default"`. Expected: both automatic-file and missing-file tests pass, and existing explicit source tests remain green.

## Task 2: Remove Product Hunt comment and GitHub Issue collection

**Files:**
- Modify: `src/index.ts`
- Delete: `src/sources/feedback.ts`
- Delete: `tests/sources/feedback.test.ts`
- Modify: `tests/pipeline.test.ts`
- Modify: `src/types.ts`

- [x] **Step 1: Write a failing no-feedback-request regression test.** Add a pipeline test with injected Product Hunt and GitHub transports. The adapters return one valid entity each; the transport records every requested URL. Run the radar with default source selection and assert no URL contains `/issues?` and no request body contains `comments(` or `comments(first:`.

```ts
expect(requests.some((request) => request.url.includes("/issues?"))).toBe(false);
expect(requests.some((request) => request.body?.includes("comments"))).toBe(false);
```

- [x] **Step 2: Run the regression test and verify RED.** Run `pnpm exec vitest run tests/pipeline.test.ts -t "feedback|comments|Issues"`. Expected failure: the current pipeline invokes `enrichSignalsWithFeedback` after entity detail enrichment.

- [x] **Step 3: Remove the enrichment call and imports.** Delete the feedback enrichment import and invocation from `runRadarInternal`; pass only entity/detail signals into dedupe, extraction, and report generation. Remove feedback-only summary aggregation from new reports while leaving optional schema fields in `src/types.ts` so old JSON remains readable.

- [x] **Step 4: Remove the unused collector.** Delete `src/sources/feedback.ts` and its direct test file. Keep legacy `RawSignal` parent/kind fields and optional discovery counters only for parsing historical runs; no new code should create feedback signals.

- [x] **Step 5: Run the focused regression suite.** Run `pnpm exec vitest run tests/pipeline.test.ts tests/sources/producthunt.test.ts tests/sources/github.test.ts tests/report.test.ts`. Expected: no comment/Issue request occurs and all entity/detail behavior remains green.

## Task 3: Make X manual records the only social discovery input in the default run

**Files:**
- Modify: `src/report/markdown.ts`
- Modify: `src/index.ts`
- Modify: `tests/report.test.ts`
- Modify: `README.md`

- [x] **Step 1: Write failing report tests for X status and provenance.** Assert a manual signal renders as `X（人工）`, preserves its X URL and original body, and does not render Product Hunt/GitHub feedback counters. Assert missing automatic input renders `当天人工输入缺失` and does not render a fake zero-signal success.

- [x] **Step 2: Run report tests and verify RED.** Run `pnpm exec vitest run tests/report.test.ts -t "X（人工）|人工输入|feedback"`. Expected failure: manual is currently rendered as `manual`, and the report still contains feedback coverage plumbing.

- [x] **Step 3: Implement provenance-aware rendering.** Add a source label helper mapping `manual` to `X（人工）`; map the automatic missing-input reason to a readable coverage line. Keep product descriptions/README evidence labeled `产品能力推导`; keep X original signals as `X 原文信号` or the existing direct-expression label.

- [x] **Step 4: Update operator documentation.** Document that the agent opens the already logged-in Chrome private List, reads only the previous 24 hours, filters reposts and generic opinions, and writes accepted posts to the date-specific JSONL file. Explicitly state that cookies, localStorage, tokens, and browser profiles are never read or persisted.

- [x] **Step 5: Run the report tests and verify GREEN.** Run `pnpm exec vitest run tests/report.test.ts`. Expected: X status, missing-input semantics, entity provenance, and existing Trends report behavior pass.

## Task 4: Validate the full default run and explicit opt-in sources

**Files:**
- Modify: `tests/config.test.ts`
- Modify: `tests/pipeline.test.ts`
- Modify: `tests/report.test.ts`
- Inspect: `data/runs/2026-09-02/report.md`

- [x] **Step 1: Add explicit opt-in coverage tests.** Assert an explicit `sourceNames: ["reddit-feed"]` or `["scys-mcp"]` run still uses its injected adapter. Assert an explicit `sourceNames: ["x-timeline"]` run still uses an injected X API transport, while the default run never invokes it.

- [x] **Step 2: Run focused source and pipeline tests.** Run `pnpm exec vitest run tests/config.test.ts tests/pipeline.test.ts tests/report.test.ts tests/sources/x-timeline.test.ts tests/sources/reddit-feed.test.ts tests/sources/scys-mcp.test.ts` and require zero failures.

- [x] **Step 3: Run the complete local validation.** Run `pnpm test`, `pnpm build`, and `git diff --check` with `RADAR_ENABLE_PUBLIC_HTTP=0` and source credential variables empty so tests cannot make implicit external requests. Require all tests and the build to pass.

- [x] **Step 4: Collect X in the authenticated browser.** Use the logged-in Chrome private List, inspect the last 24 hours, write only selected original posts into `data/runs/2026-09-02/x-web-input.jsonl`, and report the exact number of accepted posts. Do not claim X coverage if the List is unavailable or unauthenticated.

- [x] **Step 5: Run the real daily report.** Run `pnpm radar -- --date 2026-09-02` with the default source set. Record report path, source counts, accepted X signals, capability-derived terms, formal candidate count, and any blocked/unverified source states. Confirm no PH comment/GitHub Issue requests were made.

## Task 5: Review and land

**Files:**
- Inspect: all changed source, tests, docs, and the dated report

- [ ] **Step 1: Review the complete diff.** Check default/explicit source boundaries, missing/empty/error states, old projection compatibility, X provenance, and that no secret or browser state is persisted.

- [ ] **Step 2: Stage only scoped paths.** Stage the source, test, documentation, and plan files for this feature; leave pre-existing plans, `memory/`, generated data, and unrelated root-worktree edits untouched.

- [ ] **Step 3: Commit with a focused message.** Use `git commit -m "feat: use manual X and entity-only radar"` after cached diff checks pass.

- [ ] **Step 4: Fast-forward the local `main`, rerun proportional validation, and push to the previously verified GitHub repository without force-push.** If the remote is absent or diverged, report the exact state instead of changing remote configuration or overwriting history.
