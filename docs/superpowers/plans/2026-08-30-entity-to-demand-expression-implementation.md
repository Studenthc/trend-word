# Entity to Demand Expression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn evidenced Product Hunt/GitHub product entities into separately tracked, quality-rated demand expressions suitable for manual Google Trends verification.

**Architecture:** Keep `RawSignal` and existing `SeedTerm` compatibility. Add independent `DemandExpression` records with exact text, type, source relation, quote, quality state, and failure reason. Extract demand expressions before candidate ranking; candidate ranking only projects and orders them. Persist intermediate demand and quality artifacts atomically. Details are bounded to the current signal body/excerpt in this pass; the cache/transport seam is explicit for later source-specific enrichment.

**Tech Stack:** TypeScript, Zod, Vitest, existing JSON projection storage and Markdown report.

---

### Task 1: Add the demand-expression data contract

**Files:**
- Modify: `src/types.ts`
- Modify: `src/storage/run-store.ts`
- Test: `tests/demand-expressions.test.ts`
- Test: `tests/storage.test.ts`

- [x] **Step 1: Write failing schema tests** for a demand expression with `task|pain|alternative|play`, source entity relation, quote, quality state, and named failure reason; assert invalid missing quote is rejected.
- [x] **Step 2: Run `pnpm vitest run tests/demand-expressions.test.ts tests/storage.test.ts` and verify the new schema/import fails because the contract is absent.
- [x] **Step 3: Add Zod schemas and `DemandExpression` types** plus a `demand-expressions` projection validator in `RunStore`.
- [x] **Step 4: Run the focused tests and verify they pass.**
- [ ] **Step 5: Commit:** `feat: add demand expression contract` (deferred because the worktree contains unrelated existing user changes)

### Task 2: Implement rule-based extraction and quality assessment

**Files:**
- Create: `src/domain/demand-expressions.ts`
- Test: `tests/demand-expressions.test.ts`

- [x] **Step 1: Add failing tests** for task/pain/alternative/play extraction, product-name rejection, marketing-only rejection, quote binding, three-expression cap, long-body truncation, and explicit `no_demand_evidence`/`evidence_missing` outcomes.
- [x] **Step 2: Run `pnpm vitest run tests/demand-expressions.test.ts` and verify the tests fail for missing extraction functions.
- [x] **Step 3: Implement pure functions `extractDemandExpressions(signal)` and `assessDemandExpression(expression)`** using existing text normalization and sentence splitting patterns; never invent facts absent from the source.
- [x] **Step 4: Run the focused tests and verify they pass.**
- [ ] **Step 5: Commit:** `feat: extract evidenced demand expressions` (deferred because the worktree contains unrelated existing user changes)

### Task 3: Project demand expressions into the candidate queue

**Files:**
- Modify: `src/domain/candidates.ts`
- Modify: `src/types.ts`
- Test: `tests/candidates.test.ts`

- [x] **Step 1: Add failing tests** proving a quality-approved demand expression outranks its product entity, gets a distinct candidate ID, preserves its quote/source relation, and rejected/unsupported expressions remain in observation only.
- [x] **Step 2: Run `pnpm vitest run tests/candidates.test.ts` and verify the new expectations fail.
- [x] **Step 3: Add `demandExpressions` to `CandidateQueueOptions` and create demand candidates before legacy seed clusters; keep `candidate-entity-` and `candidate-demand-` IDs distinct.
- [x] **Step 4: Run candidate tests and the existing seed/candidate regression tests.**
- [ ] **Step 5: Commit:** `feat: rank demand expressions ahead of entities` (deferred because the worktree contains unrelated existing user changes)

### Task 4: Wire the pipeline and artifacts

**Files:**
- Modify: `src/index.ts`
- Modify: `src/report/markdown.ts`
- Modify: `src/report/summary.ts`
- Test: `tests/pipeline.test.ts`
- Test: `tests/report.test.ts`

- [x] **Step 1: Add failing integration tests** for `demand-expressions.json`, quality funnel counts, demand-first report ordering, and partial/empty detail states.
- [x] **Step 2: Run the focused integration tests and verify the expected artifacts/sections are absent.
- [x] **Step 3: Extract and validate demand expressions after dedupe, persist them before candidates, pass them into candidate ranking, and render a compact funnel with source/detail/extraction counts.
- [x] **Step 4: Run pipeline/report tests and verify existing report behavior remains compatible.
- [ ] **Step 5: Commit:** `feat: wire demand expression radar pipeline` (deferred because the worktree contains unrelated existing user changes)

### Task 5: Verification and handoff

**Files:**
- Modify only files required by failing checks.

- [x] **Step 1: Run `pnpm test` and confirm zero failures.
- [x] **Step 2: Run `pnpm build` and confirm exit code 0.
- [x] **Step 3: Run `git diff --check` and inspect the diff for unrelated edits.
- [x] **Step 4: Run a fixture radar and inspect the generated report and demand-expression artifact.
- [x] **Step 5: Report exact test/build/run evidence and remaining source-detail limitations.
