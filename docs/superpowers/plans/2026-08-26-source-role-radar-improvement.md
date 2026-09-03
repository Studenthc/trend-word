# Source Role New-Word Radar Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daily radar discover early expressions from Product Hunt, GitHub, X, Reddit, and manual input, while using SCYS only to validate Chinese demand and business context instead of letting SCYS title noise dominate the Trends queue.

**Architecture:** Add an explicit role for each source (`discovery` or `validation`) at the configuration boundary. Pass the role into candidate qualification so validation-only product/feature/entity mentions stay in the observation lane, while explicit user-problem evidence can still qualify. Keep raw signals and evidence unchanged, and make the Markdown report present the two-stage workflow in a compact, auditable format.

**Tech Stack:** TypeScript ESM, Zod, Vitest, pnpm, existing JSON/JSONL RunStore and Markdown report.

---

## File map

- Modify: `src/types.ts` — define source roles and validate the new configuration block.
- Modify: `src/config.ts` — change safe defaults so SCYS is optional validation, not a required discovery source.
- Modify: `radar.config.json` — record the production source-role policy explicitly.
- Modify: `src/index.ts` — pass source roles into candidate qualification and expose role-aware source health in the run context.
- Modify: `src/domain/candidates.ts` — enforce validation-source qualification rules and explain demotions.
- Modify: `src/report/markdown.ts` — show discovery/validation stages and keep the actionable report within a short daily reading loop.
- Modify: `tests/config.test.ts` — cover defaults and role schema validation.
- Modify: `tests/report.test.ts` — cover SCYS demotion, discovery-source priority, and compact role-aware output.
- Modify: `tests/candidates.test.ts` — cover explicit user-problem exceptions for validation sources.
- Modify: `README.md` — document the actual source strategy and the meaning of an unavailable SCYS validation pass.

### Task 1: Model source roles and change the default source policy

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `radar.config.json`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write failing configuration tests**

Add assertions that the default policy is `producthunt` and `github` in `required`, `x-timeline` and `reddit-feed` in `bestEffort`, and `scys-mcp` in a new `validation` list. Add a rejection case for an unsupported source role.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm vitest run tests/config.test.ts`

Expected: FAIL because `validation` is not yet part of the parsed configuration and the old defaults still require SCYS.

- [ ] **Step 3: Implement the typed role boundary**

Add:

```ts
export const sourceRoleSchema = z.enum(["discovery", "validation"]);
export type SourceRole = z.infer<typeof sourceRoleSchema>;
```

Extend `radarConfigShape.sources` with `validation: z.array(sourceTypeSchema)`. Set defaults to:

```ts
sources: {
  required: ["producthunt", "github"],
  bestEffort: ["x-timeline", "reddit-feed"],
  validation: ["scys-mcp"],
  manual: true,
}
```

Update `radar.config.json` with the same policy and leave SCYS enabled so an explicit validation run still works.

- [ ] **Step 4: Run focused tests and the type checker**

Run: `pnpm vitest run tests/config.test.ts && pnpm typecheck`

Expected: PASS for configuration tests and type checking; update any tests that construct a complete `sources` object to include `validation`.

- [ ] **Step 5: Commit the configuration boundary**

```bash
git add src/types.ts src/config.ts radar.config.json tests/config.test.ts
git commit -m "refactor: separate discovery and validation sources"
```

### Task 2: Apply source roles to candidate qualification

**Files:**
- Modify: `src/index.ts`
- Modify: `src/domain/candidates.ts`
- Test: `tests/candidates.test.ts`
- Test: `tests/report.test.ts`

- [ ] **Step 1: Write failing candidate tests**

Cover these exact cases:

```ts
it("keeps a SCYS product title out of the formal Trends pool", () => {
  const queue = buildCandidateQueue([scysSignal({ title: "FlowPilot" })], {
    sourceRoles: { "scys-mcp": "validation" },
  });
  expect(queue.formal).toHaveLength(0);
  expect(queue.backup[0]?.qualificationReason).toMatch(/validation/i);
});

it("allows an explicit SCYS user problem into the formal pool", () => {
  const queue = buildCandidateQueue([scysSignal({ body: "很多人都在问：如何批量整理播客字幕？" })], {
    sourceRoles: { "scys-mcp": "validation" },
  });
  expect(queue.formal.map((item) => item.term)).toContain("批量整理播客字幕");
});
```

Use the existing test signal factory and existing extraction syntax; do not add network calls.

- [ ] **Step 2: Run the focused tests and verify the new cases fail**

Run: `pnpm vitest run tests/candidates.test.ts tests/report.test.ts`

Expected: FAIL because `buildCandidateQueue` has no source-role option and SCYS is currently treated like a discovery source.

- [ ] **Step 3: Implement role-aware qualification**

Extend `CandidateQueueOptions` with:

```ts
sourceRoles?: Partial<Record<RawSignal["sourceType"], "discovery" | "validation">>;
```

Resolve an omitted role as `discovery`. For clusters from a `validation` source, set `formal` only when the seed kind is `problem` or `search_term`; otherwise put the candidate in `backup` with `qualificationReason: "SCYS 只作中文需求验证，产品/功能名需先有早期发现源佐证"` and missing fields containing `早期发现源` and `Google Trends 7d`. Preserve the existing multi-source and explicit-problem logic for discovery sources.

In `src/index.ts`, build the role map from `config.sources.required`, `bestEffort`, and `validation`, then pass it to `buildCandidateQueue`. Do not change raw-signal persistence or historical expression IDs.

- [ ] **Step 4: Run candidate, pipeline, and type checks**

Run: `pnpm vitest run tests/candidates.test.ts tests/pipeline.test.ts tests/report.test.ts && pnpm typecheck`

Expected: PASS; SCYS-only entities are backup candidates while explicit problem expressions can still enter the formal pool.

- [ ] **Step 5: Commit the qualification change**

```bash
git add src/index.ts src/domain/candidates.ts tests/candidates.test.ts tests/report.test.ts
git commit -m "feat: qualify candidates by source role"
```

### Task 3: Make the daily report explain the two-stage workflow concisely

**Files:**
- Modify: `src/report/markdown.ts`
- Modify: `tests/report.test.ts`

- [ ] **Step 1: Write failing report assertions**

Assert that the report contains a short workflow line explaining `发现源 → Google Trends 7d → SCYS 中文需求验证`, labels each source as `发现` or `验证`, and does not print full evidence/opportunity inventories. Assert that a SCYS-only backup item says it is waiting for an early discovery source.

- [ ] **Step 2: Run the focused report test and verify it fails**

Run: `pnpm vitest run tests/report.test.ts`

Expected: FAIL because source rows have no role labels and the report has no workflow explanation.

- [ ] **Step 3: Implement compact role-aware rendering**

Extend `MarkdownReportInput` with an optional `sourceRoles` map. Render immediately below the title:

```md
> 工作流：发现源找刚出现的表达 → 手工查 Google Trends 过去 7 天 → SCYS 只验证中文需求与变现场景
```

Render source rows as `- producthunt（发现）: ...` and `- scys-mcp（验证）: ...`. Keep no more than 10 formal candidates and 10 backup candidates, cap excerpts at the existing limits, and make the backup line include only term, demotion reason, missing check, and original URL. Keep the existing data-location links for auditability.

- [ ] **Step 4: Run report tests and inspect generated Markdown**

Run: `pnpm vitest run tests/report.test.ts`

Expected: PASS and the fixture report remains below 2,500 characters for the long-body case.

- [ ] **Step 5: Commit the report change**

```bash
git add src/report/markdown.ts tests/report.test.ts
git commit -m "docs: clarify radar discovery and validation stages"
```

### Task 4: Update operating documentation and run an end-to-end fixture audit

**Files:**
- Modify: `README.md`
- Test: `tests/config.test.ts`, `tests/pipeline.test.ts`, `tests/report.test.ts`
- Output: `data/runs/2026-08-26/` in a temporary workspace, not the repository

- [ ] **Step 1: Update the README operating contract**

Document that Product Hunt/GitHub/X/Reddit/manual input discover early expressions; SCYS is a validation source and its absence is a coverage warning rather than evidence that no new words exist. State that Google Trends remains a manual 7-day check and that the formal pool is intentionally bounded to 10 items.

- [ ] **Step 2: Run the full automated suite**

Run: `pnpm test && pnpm typecheck && pnpm build`

Expected: all tests pass, type checking succeeds, and the CLI build succeeds.

- [ ] **Step 3: Run the fixture radar end to end**

Run: `pnpm radar -- --date 2026-08-26 --sources fixtures --workspace /tmp/trend-word-role-audit`

Expected: exit 0, a report is written under `/tmp/trend-word-role-audit/data/runs/2026-08-26/report.md`, and the report shows the discovery/validation workflow plus a bounded formal/backup pool.

- [ ] **Step 4: Audit the resulting artifacts**

Read the generated `report.md`, `run-summary.json`, `discovery-summary.json`, and `candidates.json`. Verify that source health is explicit, no failed source is presented as “no demand”, and every formal candidate has a Trends URL and an original source URL.

- [ ] **Step 5: Commit documentation and finish with a clean diff review**

```bash
git add README.md
git commit -m "docs: document source roles for daily radar"
git diff HEAD~4..HEAD --stat
git status --short
```

## Self-review

- Spec coverage: source availability, auditable raw signals, candidate qualification, compact Markdown, manual Trends verification, and SCYS coverage warnings are covered by Tasks 1–4. No browser/MCP credential behavior is changed.
- Placeholder scan: no TODO/TBD or deferred implementation steps are used; every task names files, tests, commands, and expected outcomes.
- Type consistency: `sourceRoles` is optional at the candidate API, uses the same `SourceType` keys as the config, and is assembled once in `runRadar` before queue construction.
- Scope: this plan intentionally does not invent a new X/Reddit transport or a Google Trends API. Those are separate source-integration projects and must be validated independently before becoming default discovery sources.
