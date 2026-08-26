# Candidate Quality Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ensure the daily Google Trends verification pool contains concrete user demand and emerging concepts, while product names and generic feature phrases stay in the observation pool.

**Architecture:** Keep extraction broad enough to discover raw expressions, then add a separate qualification gate before formal candidates. Normalize Chinese/English aliases into one cluster, classify source evidence, and require either explicit user-problem language or corroboration from multiple independent observations. Product Hunt/GitHub entities remain useful backup signals but cannot crowd out demand-led candidates.

**Tech Stack:** TypeScript ESM, Vitest, Zod, pnpm, existing JSON/JSONL projections and Markdown report.

---

## File map

- Modify `src/domain/normalize.ts`: normalize cross-language aliases and common English stopwords.
- Modify `src/domain/seed-terms.ts`: reject generic feature phrases and classify product/entity versus demand expressions.
- Modify `src/domain/expression-clusters.ts`: merge explicit Chinese/English aliases without fuzzy Chinese matching.
- Modify `src/domain/candidates.ts`: apply formal-candidate quality gates and keep rejected items in backup with reasons.
- Modify `src/report/markdown.ts`: distinguish “今天先查” from “观察候选”.
- Modify `src/types.ts`: add candidate qualification reason fields.
- Modify `tests/normalize.test.ts`, `tests/seed-terms.test.ts`, `tests/expression-clusters.test.ts`, `tests/candidates.test.ts`, and `tests/report.test.ts`: cover each gate and report contract.
- Modify `README.md`: document formal versus observation candidates.

## Scope boundaries

- Do not add a Google Trends API.
- Do not delete raw signals or historical expressions when a candidate is rejected.
- Do not treat a product name as a search trend without user-language or cross-source evidence.
- Do not claim cross-language equivalence unless an explicit alias map or matching normalized token set supports it.

### Task 1: Cross-language normalization and noise vocabulary

**Files:** `src/domain/normalize.ts`, `src/domain/seed-terms.ts`, `tests/normalize.test.ts`, `tests/seed-terms.test.ts`

- [ ] Add failing tests for `AI workflow` and `AI 工作流` sharing a canonical alias key, and for rejecting `Workflow automation`, `new workflow`, `practical workflow`, `AI tool`, and `AI tools` as generic feature expressions.
- [ ] Run `pnpm exec vitest run tests/normalize.test.ts tests/seed-terms.test.ts`; expect the new assertions to fail.
- [ ] Add explicit alias groups for `workflow/工作流`, `agent/代理`, `model/模型`, `generator/生成器`, and `automation/自动化`; remove English article/adjective prefixes before token comparison; expand discovery noise with generic feature phrases.
- [ ] Keep product names such as `FlowPilot` and concrete phrases such as `AI workflow copilot` available as metadata/backup terms.
- [ ] Run the focused tests and `pnpm build`; expect pass.
- [ ] Commit `feat: normalize bilingual radar expressions and feature noise`.

### Task 2: Demand-led candidate quality gate

**Files:** `src/types.ts`, `src/domain/candidates.ts`, `tests/candidates.test.ts`

- [ ] Add failing tests proving a single Product Hunt product, a single GitHub repository, and a single generic feature phrase go to `backup`, while `用户问有没有一人公司自动化方案` enters `formal`.
- [ ] Add a test with two independent sources mentioning the same concrete concept and assert it enters `formal` even without a problem marker.
- [ ] Run `pnpm exec vitest run tests/candidates.test.ts`; expect the new tests to fail.
- [ ] Add `qualificationReason` and `evidenceKind` to `RadarCandidate`. Formal eligibility must require one of: `problem`, `search_term`, or a non-generic concept observed in at least two independent source fingerprints/authors. Product/model/feature metadata from one source is backup-only.
- [ ] Preserve backup entries with missing fields such as `用户问题`, `第二个独立来源`, and `Google Trends 7d`; never discard them from raw projections.
- [ ] Sort formal candidates by demand evidence, recent frequency delta, independent authors, source families, then stable term order. Keep the cap at ten after diversity selection.
- [ ] Run focused candidate tests and `pnpm build`; expect pass.
- [ ] Commit `feat: gate the Trends pool on demand evidence`.

### Task 3: Cross-language cluster and deduplication behavior

**Files:** `src/domain/expression-clusters.ts`, `src/domain/dedupe.ts`, `tests/expression-clusters.test.ts`, `tests/dedupe.test.ts`

- [ ] Add failing tests asserting `AI workflow` and `AI 工作流` form one cluster with aliases retained, while `FlowPilot` remains separate.
- [ ] Add a test asserting reposts with the same source fingerprint count once toward independent evidence.
- [ ] Run `pnpm exec vitest run tests/expression-clusters.test.ts tests/dedupe.test.ts`; expect the new assertions to fail.
- [ ] Implement explicit bilingual token canonicalization in `seedTermKey`, use source fingerprint for repetition dedupe, and retain first observed user wording as `primaryTerm`.
- [ ] Ensure `sourceTypes`, `independentAuthors`, `rawSignalIds`, and freshness are computed from deduped observations.
- [ ] Run focused tests, `pnpm build`, and commit `fix: dedupe bilingual and reposted expressions correctly`.

### Task 4: Short report with formal and observation lanes

**Files:** `src/report/markdown.ts`, `tests/report.test.ts`, `README.md`

- [ ] Add failing report tests requiring a `## 今天先查这 N 个词` section and a separate `## 观察候选` section; the formal section must not contain a single-source Product Hunt/GitHub entity.
- [ ] Run `pnpm exec vitest run tests/report.test.ts`; expect failure.
- [ ] Render formal candidates with `为什么现在`, `用户原话`, `证据类型`, source/date, Trends link, and missing checks. Render backup candidates with one-line rejection reason and next evidence needed.
- [ ] Keep the report below 3500 characters for ten formal candidates plus ten observations.
- [ ] Update README examples and explain that an empty formal pool can be correct when only product/entity signals are available.
- [ ] Run report tests and commit `docs: clarify formal and observation radar lanes`.

### Task 5: End-to-end acceptance

**Files:** `tests/pipeline.test.ts`, `docs/decisions/2026-08-27-candidate-quality-gate.md`

- [ ] Add an end-to-end fixture containing generic Product Hunt/GitHub signals, one SCYS user problem, and one repeated cross-source concept; assert only demand-led/repeated concepts enter the ten-item verification pool.
- [ ] Run `pnpm test && pnpm build`.
- [ ] Run `pnpm radar -- --date 2026-08-27 --sources fixtures --workspace /tmp/new-word-quality-gate-2026-08-27` and inspect the report.
- [ ] Record the acceptance result, source limitations, and remaining need for a real logged-in SCYS run in the decision note.

## Self-review

- Every observed problem from the latest report maps to a task: generic English phrases (Task 1), product/entity leakage (Task 2), bilingual duplicates (Task 3), and unreadable lane semantics (Task 4).
- The plan preserves early discovery in backup instead of hiding uncertain signals.
- No step requires credentials, undocumented APIs, or an unavailable social source.
- All names used across tasks are defined before use: `qualificationReason`, `evidenceKind`, `seedTermKey`, formal lane, and observation lane.

## Validation commands

```bash
pnpm test
pnpm build
pnpm radar -- --date 2026-08-27 --sources fixtures --workspace /tmp/new-word-quality-gate-2026-08-27
```
