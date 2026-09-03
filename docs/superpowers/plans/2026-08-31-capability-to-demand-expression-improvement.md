# Capability to Demand Expression Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert useful Product Hunt/GitHub capability descriptions into clearly labeled, searchable demand terms while keeping direct user evidence higher priority and preventing marketing copy from being presented as user quotes.

**Architecture:** Extend the existing `DemandExpression` contract with an origin (`user_evidence` or `capability_derived`) and a search-oriented transformation record. Keep the original sentence as evidence, generate a concise query term through deterministic rules, and let candidate scoring rank direct user evidence above capability-derived terms. Product entities, derived demand terms, and direct demand terms remain separate candidates with independent IDs.

**Tech Stack:** TypeScript, Zod, Vitest, existing `RawSignal`/`DemandExpression` pipeline, JSON projections, Markdown report.

---

### Task 1: Extend the demand-expression contract with provenance

**Files:**
- Modify: `src/types.ts`
- Modify: `src/storage/run-store.ts`
- Test: `tests/demand-expressions.test.ts`
- Test: `tests/storage.test.ts`

- [ ] **Step 1: Write the failing contract tests.** Add a `DemandExpression` fixture with `origin: "capability_derived"`, `sourceText`, `transformation`, and `qualityState: "review"`; assert a direct user expression accepts `origin: "user_evidence"`, and assert missing `sourceText` or an unknown origin is rejected.
- [ ] **Step 2: Run the focused tests to verify RED.** Run `pnpm vitest run tests/demand-expressions.test.ts tests/storage.test.ts`. Expected: the new fields are not accepted because the schema does not yet define them.
- [ ] **Step 3: Add the minimal Zod fields.** In `src/types.ts`, add:

```ts
origin: z.enum(["user_evidence", "capability_derived"]),
sourceText: z.string().min(1).max(2000),
transformation: z.string().min(1).max(240),
```

Keep `evidenceQuote` as the bounded citation shown to the user and keep existing fields backward-compatible only where existing projections require it. Register the unchanged `demand-expressions` array validator in `RunStore`.
- [ ] **Step 4: Run the focused tests to verify GREEN.** Run `pnpm vitest run tests/demand-expressions.test.ts tests/storage.test.ts`; expected: all focused tests pass.
- [ ] **Step 5: Do not commit shared dirty files.** Record the contract change in the working tree; a commit is deferred because `src/types.ts` and `src/storage/run-store.ts` already contain unrelated user changes.

### Task 2: Add deterministic capability-to-query transformation

**Files:**
- Modify: `src/domain/demand-expressions.ts`
- Test: `tests/demand-expressions.test.ts`

- [ ] **Step 1: Write failing transformation tests.** Add cases for:

```ts
expect(extractDemandExpressions(signal({ sourceType: "producthunt", body: "A launch for creators who generate AI photos." }))).toContainEqual(expect.objectContaining({ text: "AI photo generator", origin: "capability_derived", qualityState: "review" }));
expect(extractDemandExpressions(signal({ sourceType: "producthunt", body: "Create Hindustani classical music notation in a web app." }))).toContainEqual(expect.objectContaining({ text: "Hindustani classical music notation", origin: "capability_derived" }));
```

Also assert `evidenceQuote`/`sourceText` retains the original sentence and `transformation` explains the rewrite. Add a negative case for adjective-only marketing text such as `beautiful, powerful, revolutionary AI platform`.
- [ ] **Step 2: Run `pnpm vitest run tests/demand-expressions.test.ts` and verify RED.** Expected: the extractor either returns no capability-derived expression or returns the original gerund phrase instead of a search-oriented query.
- [ ] **Step 3: Implement the minimum rule transformer.** Add pure helpers in `src/domain/demand-expressions.ts`:

```ts
function deriveCapabilityQuery(sentence: string): { text: string; transformation: string } | undefined
```

Implement only these deterministic transformations:

1. `generate <modifier> photos/images` → `<modifier> photo/image generator`.
2. `create <domain> notation` → `<domain> notation`.
3. `automate <object>` / `automating <object>` → `object automation` when the object is concrete and at least two words long.
4. Remove Markdown links, bullets, pipes, HTML, and code markers before matching.

The transformer must not add a new audience, market size, revenue claim, trend claim, or tool category not supported by the source sentence. Return `undefined` for generic platform adjectives and expressions shorter than two meaningful words.
- [ ] **Step 4: Mark provenance correctly.** Direct question/problem/alternative patterns produce `origin: "user_evidence"`; Product Hunt/GitHub capability patterns produce `origin: "capability_derived"`, `qualityState: "review"`, and a lower score. Preserve the original sentence in `sourceText` and `evidenceQuote`.
- [ ] **Step 5: Run the extractor tests to verify GREEN.** Run `pnpm vitest run tests/demand-expressions.test.ts`; expected: all direct-evidence and capability-derived cases pass.
- [ ] **Step 6: Do not commit shared dirty files.** Keep the change in the current feature branch because the shared source file contains previous user edits.

### Task 3: Rank direct and derived demand candidates separately

**Files:**
- Modify: `src/domain/candidates.ts`
- Test: `tests/candidates.test.ts`

- [ ] **Step 1: Write failing candidate tests.** Add tests asserting:

```ts
const direct = demand("user wants an AI photo generator", "user_evidence", 90);
const derived = demand("generate AI photos", "capability_derived", 55);
const result = buildCandidateQueue([signal("direct-source"), signal("derived-source")], { demandExpressions: [derived, direct] });
expect(result.formal[0]).toMatchObject({ term: "AI photo generator", evidenceKind: "user_evidence" });
expect(result.formal[1]).toMatchObject({ term: "AI photo generator", evidenceKind: "capability_derived" });
```

Use distinct candidate IDs (`candidate-demand-user-...` and `candidate-demand-capability-...`) so feedback for one provenance does not suppress the other. Assert a derived expression remains eligible for Trends but includes `用户证据待确认` in `missingFields` or `qualificationReason`.
- [ ] **Step 2: Run `pnpm vitest run tests/candidates.test.ts` and verify RED.** Expected: current candidates do not expose provenance and the two same-text expressions collapse into one candidate.
- [ ] **Step 3: Add provenance-aware candidate projection.** In `candidateForDemand`, include origin in the candidate ID, map origin to `evidenceKind`, and score direct evidence above derived evidence while preserving quality score and freshness. A `capability_derived` expression with `qualityState: "review"` is allowed into the formal Trends queue, but must carry the explicit missing check `用户原话/替代诉求待确认`.
- [ ] **Step 4: Keep product entities separate.** Continue using `candidate-entity-...` for metadata product entities and never use a product entity ID for a derived demand expression.
- [ ] **Step 5: Run candidate regression tests.** Run `pnpm vitest run tests/candidates.test.ts tests/seed-terms.test.ts`; expected: all existing product/entity gates and new provenance tests pass.

### Task 4: Make the report explain derived demand terms

**Files:**
- Modify: `src/report/markdown.ts`
- Modify: `src/index.ts`
- Modify: `src/types.ts`
- Test: `tests/report.test.ts`
- Test: `tests/pipeline.test.ts`

- [ ] **Step 1: Write failing report tests.** Assert a capability-derived formal candidate renders:

```text
- 类型：产品能力推导，待 Google Trends 验证
- 来源实体：...
- 证据：产品描述原文，而非用户原话
```

Assert a direct candidate renders `类型：用户原话需求`. Assert the report does not describe a capability-derived quote as `用户原话`.
- [ ] **Step 2: Run `pnpm vitest run tests/report.test.ts tests/pipeline.test.ts` and verify RED.** Expected: the report currently always labels candidate context as `用户原话` and the pipeline does not persist provenance fields in evidence.
- [ ] **Step 3: Render provenance-aware labels.** Update `candidateLines` to use the candidate origin/evidence kind and show concise wording:

```ts
const evidenceLabel = candidate.evidenceKind === "capability_derived"
  ? "产品能力推导，待 Google Trends 验证"
  : "用户原话需求";
```

Use `证据` rather than `用户原话` for capability-derived candidates. Keep the report capped at 10 formal and 10 observation entries.
- [ ] **Step 4: Persist provenance in the evidence projection.** Demand evidence should use `subjectId: demand.id`, preserve `demand.evidenceQuote`, and add a note containing the origin and transformation; no generated query may replace the citation.
- [ ] **Step 5: Add a compact funnel count.** Extend discovery summary with `directDemandCount` and `capabilityDerivedCount`, then render them in the existing one-line funnel without adding a long section.
- [ ] **Step 6: Run report/pipeline tests.** Run `pnpm vitest run tests/report.test.ts tests/pipeline.test.ts`; expected: reports distinguish user evidence from capability-derived queries and artifacts validate.

### Task 5: Run today’s real report and tune only verified false positives

**Files:**
- Test/inspect: `data/runs/2026-08-31/report.md`
- Test/inspect: `data/runs/2026-08-31/demand-expressions.json`
- Test/inspect: `data/runs/2026-08-31/discovery-summary.json`

- [ ] **Step 1: Run focused tests and build.** Run `pnpm vitest run tests/demand-expressions.test.ts tests/candidates.test.ts tests/report.test.ts tests/pipeline.test.ts && pnpm build`.
- [ ] **Step 2: Run the real radar with the existing launchd inheritance.** Run `pnpm radar -- --date 2026-08-31` and record the exit code, source statuses, detail success count, direct demand count, capability-derived count, and formal candidate count.
- [ ] **Step 3: Inspect the top 10 formal candidates.** Verify every candidate has a Google Trends query term, source URL, original evidence, and an explicit provenance label. Reject only expressions that are demonstrably generic, Markdown-derived, or unsupported by their source sentence.
- [ ] **Step 4: Run the full regression suite.** Run `pnpm test && pnpm build && git diff --check`; expected: zero test failures, build exit code 0, and no whitespace errors.
- [ ] **Step 5: Report the real result separately from test fixtures.** Include exact counts and clearly state any remaining coverage gaps for X, Reddit, and SCYS.

## Self-review checklist

- The plan preserves the agreed distinction between user evidence and product capability, but allows both to become searchable demand terms.
- Every generated query remains linked to its original sentence and source URL.
- Direct user evidence ranks above capability-derived terms.
- Capability-derived terms are not falsely labeled as user quotes.
- Product entities retain independent observation candidates.
- No Google Trends API, X/Reddit authentication, database, or unrelated source changes are included.
- Existing dirty user changes are preserved; shared-file commits are deferred rather than bundling unrelated work.
