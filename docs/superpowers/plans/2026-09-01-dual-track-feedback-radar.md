# Dual-Track Feedback Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GitHub/Product Hunt product descriptions produce first-class capability search terms while adding a low-cost feedback layer that extracts real user demand from GitHub Issues and Product Hunt comments.

**Architecture:** Keep product entities, capability-derived terms, and user-evidence terms as separate evidence types. After entity discovery and README/description enrichment, fetch bounded feedback records for the top entities, represent each feedback item as a traceable `RawSignal`, then run the existing seed/demand/candidate/report pipeline over both entity and feedback signals. Capability terms can enter the 10-item Trends queue when concrete, while feedback terms receive higher evidence priority.

**Tech Stack:** TypeScript, Zod, Vitest, existing `HttpTransport`, GitHub REST API, Product Hunt GraphQL API, JSON cache/projections, Markdown report.

---

## File map

- Create `src/sources/feedback.ts`: bounded GitHub Issue and Product Hunt comment requests, parsing, cache, and feedback health results.
- Modify `src/types.ts`: add optional parent/evidence metadata to `RawSignal` and feedback result fields to `DiscoverySummary`/`SourceQuality`.
- Modify `src/index.ts`: run feedback enrichment after entity detail enrichment, pass feedback health into the summary and report.
- Modify `src/domain/demand-expressions.ts`: recognize feedback signals as direct user evidence and preserve issue/comment text as the quote.
- Modify `src/domain/seed-terms.ts`: avoid treating feedback titles as repository/product entities and extract concrete capability phrases from entity descriptions.
- Modify `src/domain/candidates.ts`: allow concrete capability-derived terms into the Trends queue and rank direct feedback above derived capability terms.
- Modify `src/report/markdown.ts`: show a compact evidence label and feedback coverage without calling capability text user quotes.
- Test `tests/sources/feedback.test.ts`, `tests/demand-expressions.test.ts`, `tests/seed-terms.test.ts`, `tests/candidates.test.ts`, `tests/report.test.ts`, and `tests/pipeline.test.ts`.

## Task 1: Add traceable feedback signal contracts

**Files:**
- Modify: `src/types.ts`
- Test: `tests/sources/feedback.test.ts`
- Test: `tests/storage.test.ts`

- [ ] **Step 1: Write failing schema tests.** Add fixtures asserting a feedback `RawSignal` accepts `parentSignalId`, `signalKind: "feedback"`, and tags such as `"github-issue"`; assert a normal entity remains valid without these optional fields.

```ts
expect(parseRawSignal({
  id: "github-issue-acme-flowpilot-12",
  sourceType: "github",
  sourceName: "GitHub Issues",
  sourceUrl: "https://github.com/acme/flowpilot/issues/12",
  externalId: "acme/flowpilot#12",
  title: "Looking for a Zapier alternative",
  body: "We need a self-hosted replacement for Zapier.",
  parentSignalId: "github-acme/flowpilot",
  signalKind: "feedback",
  tags: ["feedback", "github-issue"],
  fetchedAt: "2026-09-01T00:00:00.000Z",
  sourceTier: "community",
  sourceFingerprint: "github:issue:acme/flowpilot#12",
  evidenceStatus: "verified",
})).toMatchObject({ signalKind: "feedback", parentSignalId: "github-acme/flowpilot" });
```

- [ ] **Step 2: Run the focused tests and verify RED.** Run `pnpm exec vitest run tests/sources/feedback.test.ts tests/storage.test.ts`. Expected failure: `RawSignal` rejects the new fields or the fixture cannot be parsed.
- [ ] **Step 3: Add optional Zod fields.** Extend `rawSignalSchema` with:

```ts
parentSignalId: z.string().optional(),
signalKind: z.enum(["entity", "feedback"]).optional(),
```

Keep `tags` as the source-specific subtype marker and do not make either field required for existing persisted runs.
- [ ] **Step 4: Add feedback summary fields.** Extend `sourceQualitySchema` with optional `feedbackCount`, and `discoverySummarySchema` with optional `feedbackAttempted`, `feedbackSucceeded`, and `feedbackUnavailable`. Keep them optional so older projections remain readable.
- [ ] **Step 5: Run the focused tests and verify GREEN.** Run `pnpm exec vitest run tests/sources/feedback.test.ts tests/storage.test.ts`.

## Task 2: Implement bounded GitHub Issues and Product Hunt comments enrichment

**Files:**
- Create: `src/sources/feedback.ts`
- Test: `tests/sources/feedback.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing parser and request tests.** Cover these behaviors:

```ts
it("turns recent GitHub issues into feedback signals and skips pull requests", async () => {
  const result = await fetchEntityFeedback(entity("github"), transportReturning([
    { number: 12, title: "Looking for a Zapier alternative", body: "We need a self-hosted replacement.", html_url: "https://github.com/acme/flowpilot/issues/12", user: { id: 7, login: "user-a" }, created_at: "2026-09-01T00:00:00.000Z" },
    { number: 13, title: "Pull request", body: "not feedback", pull_request: {}, html_url: "https://github.com/acme/flowpilot/pull/13" },
  ]), "2026-09-01T01:00:00.000Z");
  expect(result.signals).toHaveLength(1);
  expect(result.signals[0]).toMatchObject({ signalKind: "feedback", parentSignalId: "github-acme/flowpilot", tags: ["feedback", "github-issue"], title: "Looking for a Zapier alternative" });
});

it("parses Product Hunt comments and keeps the parent launch relation", async () => {
  const result = await fetchEntityFeedback(entity("producthunt"), graphqlTransportReturning({ data: { post: { comments: { edges: [{ node: { id: "comment-1", body: "I need a way to export the generated reports.", createdAt: "2026-09-01T00:00:00.000Z", user: { id: "user-1", name: "User" } } }] } } } }), "2026-09-01T01:00:00.000Z");
  expect(result.signals[0]).toMatchObject({ signalKind: "feedback", parentSignalId: "producthunt-ph-1", sourceName: "Product Hunt comments", body: expect.stringContaining("export") });
});
```

Also cover 401/403/429, GraphQL errors, malformed JSON, empty comments, and a missing transport. Expected behavior is a named `unavailable`/`failed` result, never an empty-success claim.
- [ ] **Step 2: Run the source tests to verify RED.** Run `pnpm exec vitest run tests/sources/feedback.test.ts`. Expected failure: `src/sources/feedback.ts` does not exist.
- [ ] **Step 3: Implement the bounded feedback API.** Export:

```ts
export type FeedbackTransport = (request: { url: string; method?: "GET" | "POST"; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; headers: Headers; text(): Promise<string> }>;
export type FeedbackResult = { status: "success" | "empty" | "unavailable" | "failed"; signals: RawSignal[]; errorCode?: string };
export async function fetchEntityFeedback(signal: RawSignal, transport: FeedbackTransport, fetchedAt: string): Promise<FeedbackResult>;
export async function enrichSignalsWithFeedback(signals: RawSignal[], transports: { github?: FeedbackTransport; producthunt?: FeedbackTransport }, workspaceRoot: string, fetchedAt: string, limit = 20): Promise<{ signals: RawSignal[]; results: Array<{ sourceType: "github" | "producthunt"; parentSignalId: string; result: FeedbackResult }> }>;
```

For GitHub, request only `GET https://api.github.com/repos/{owner}/{repo}/issues?state=open&sort=created&direction=desc&per_page=5`; validate the host and `owner/repo` shape, skip records containing `pull_request`, and map each issue body/title into a feedback `RawSignal`. For Product Hunt, POST a single bounded GraphQL query for `post(id) { comments(first: 10) { edges { node { id body createdAt user { id name } } } } }`; GraphQL `errors` become `unavailable`.
- [ ] **Step 4: Add a small JSON cache.** Cache by `github:{repo}` or `producthunt:{postId}` in `data/cache/entity-feedback.json`; reuse successful and empty results for the same run, but retry failed/unavailable results on a later run. Never cache credentials.
- [ ] **Step 5: Wire enrichment after entity details.** In `runRadarInternal`, build feedback transports from the existing GitHub/Product Hunt transports, then call:

```ts
const feedbackEnrichment = await enrichSignalsWithFeedback(rawSignals, feedbackTransports, workspaceRoot, attemptedAt, 20);
rawSignals = feedbackEnrichment.signals;
```

The original source health remains the collection health; feedback result states are reported separately so a comment API gap does not erase entity discovery.
- [ ] **Step 6: Run source and pipeline tests.** Run `pnpm exec vitest run tests/sources/feedback.test.ts tests/pipeline.test.ts` and verify feedback signals are persisted in `raw-signals.jsonl` and the run remains complete when comments are unavailable.

## Task 3: Separate feedback extraction from entity/capability extraction

**Files:**
- Modify: `src/domain/demand-expressions.ts`
- Modify: `src/domain/seed-terms.ts`
- Test: `tests/demand-expressions.test.ts`
- Test: `tests/seed-terms.test.ts`

- [ ] **Step 1: Write failing extraction tests.** Add an Issue and a Product Hunt comment fixture with direct user language:

```ts
const issue = signal({ sourceType: "github", signalKind: "feedback", tags: ["feedback", "github-issue"], title: "Looking for a Zapier alternative", body: "I need a self-hosted replacement for Zapier." });
expect(extractDemandExpressions(issue)).toContainEqual(expect.objectContaining({ text: "replace Zapier", origin: "user_evidence", evidencePrecision: "exact" }));

const comment = signal({ sourceType: "producthunt", signalKind: "feedback", tags: ["feedback", "producthunt-comment"], title: "Export request", body: "I need a way to export generated reports." });
expect(extractDemandExpressions(comment)).toContainEqual(expect.objectContaining({ origin: "user_evidence", evidenceQuote: expect.stringContaining("export") }));
```

Assert that the original GitHub repository title is not extracted as a product entity from a feedback signal, while a normal entity still extracts its repository name. Assert that a README-only sentence remains `capability_derived`.
- [ ] **Step 2: Run the focused tests and verify RED.** Run `pnpm exec vitest run tests/demand-expressions.test.ts tests/seed-terms.test.ts`.
- [ ] **Step 3: Add feedback helpers and patterns.** Add `isFeedbackSignal(signal)` using `signal.signalKind === "feedback"` or the `feedback` tag. For feedback, combine title and body for matching, but keep the full original sentence in `sourceText` and `evidenceQuote`. Recognize first-person/explicit feedback patterns such as `I need`, `I want`, `looking for`, `feature request`, `alternative to`, `replace`, `doesn't work`, `can't`, and `how do I`. Mark these as `user_evidence`; do not run product capability rewriting on them.
- [ ] **Step 4: Exclude feedback from entity seed extraction.** In `extractSeedTerms`, skip GitHub repository-name and Product Hunt product-name metadata extraction when `isFeedbackSignal(signal)` is true. Feedback terms should come from demand extraction and the issue/comment quote, not from the parent product or issue title as a fake entity.
- [ ] **Step 5: Broaden capability extraction without inventing facts.** Keep the original sentence as evidence and add concrete templates for phrases such as `for building internal tools`, `build AI applications`, `generate ...`, and `automate ...`. Return one to three concise noun-style search terms per entity, rejecting only generic standalone words (`AI`, `platform`, `tool`, `automation`) and README setup instructions. Every generated term remains `origin: "capability_derived"` and `qualityState: "review"`.
- [ ] **Step 6: Run extractor tests and verify GREEN.** Run `pnpm exec vitest run tests/demand-expressions.test.ts tests/seed-terms.test.ts`.

## Task 4: Put capability and user-evidence terms in the same Trends queue with explicit ranking

**Files:**
- Modify: `src/domain/candidates.ts`
- Test: `tests/candidates.test.ts`

- [ ] **Step 1: Write failing candidate tests.** Assert that a concrete capability term from a GitHub/Product Hunt description is formal and labeled derived, while a direct Issue/comment term ranks before it:

```ts
const result = buildCandidateQueue([capabilityEntity, feedbackIssue], { demandExpressions: [capabilityDemand, directDemand], now: "2026-09-01T00:00:00.000Z" });
expect(result.formal.map((item) => item.term)).toEqual(expect.arrayContaining(["internal tool builder", "replace Zapier"]));
expect(result.formal.find((item) => item.term === "replace Zapier")?.evidenceOrigin).toBe("user_evidence");
expect(result.formal.find((item) => item.term === "internal tool builder")?.evidenceOrigin).toBe("capability_derived");
expect(result.formal.indexOf(result.formal.find((item) => item.term === "replace Zapier")!)).toBeLessThan(result.formal.indexOf(result.formal.find((item) => item.term === "internal tool builder")!));
```

Keep a product entity with no capability or feedback evidence in the observation queue. Keep inferred social phrases observation-only.
- [ ] **Step 2: Run candidate tests and verify RED.** Run `pnpm exec vitest run tests/candidates.test.ts`. Expected failure: the current broad-capability gate demotes concrete capability terms or the formal diversity selection changes their order.
- [ ] **Step 3: Narrow the broad-capability gate.** Replace the current broad regex behavior with a small generic set and a concrete-expression check. A capability term is eligible when it has at least two meaningful words, contains a supported object (`application`, `tool`, `workflow`, `image`, `video`, `agent`, `report`, `domain`, etc.), and is not an action clause or a generic standalone category. Keep `qualityState: "review"` and `missingFields: ["用户原话/替代诉求待确认", "Google Trends 7d", "SERP/供给"]`.
- [ ] **Step 4: Make feedback priority explicit.** Add a provenance rank before the existing score tie-breaker: `user_evidence` first, `capability_derived` second, product entity third. Preserve distinct candidate IDs (`candidate-demand-user_evidence-*`, `candidate-demand-capability_derived-*`, `candidate-entity-*`).
- [ ] **Step 5: Keep source diversity and queue caps.** Apply the existing 10-item formal limit after provenance ranking and source balancing. Do not allow one repository to contribute more than one capability-derived query to the formal queue.
- [ ] **Step 6: Run candidate regressions and verify GREEN.** Run `pnpm exec vitest run tests/candidates.test.ts tests/demand-expressions.test.ts tests/seed-terms.test.ts`.

## Task 5: Report the two evidence tracks and feedback coverage

**Files:**
- Modify: `src/index.ts`
- Modify: `src/report/markdown.ts`
- Modify: `src/types.ts`
- Test: `tests/report.test.ts`
- Test: `tests/pipeline.test.ts`

- [ ] **Step 1: Write failing report tests.** Assert these labels are distinct:

```text
类型：用户原话需求
类型：产品能力推导
类型：产品实体观察
```

Assert a capability line says `证据：产品描述原文` or equivalent and never says `用户原话`; assert a feedback line includes its issue/comment source URL. Assert the source summary includes feedback counts/unavailable status without changing an available entity source to zero.
- [ ] **Step 2: Run report/pipeline tests and verify RED.** Run `pnpm exec vitest run tests/report.test.ts tests/pipeline.test.ts`.
- [ ] **Step 3: Render provenance-aware candidate lines.** Update `candidateLines` and `backupCandidateLines` so direct feedback shows the original quote as `用户原话`, capability terms show `产品能力推导`, and entities show `产品实体观察`. Keep each line concise and retain the Trends URL.
- [ ] **Step 4: Add feedback coverage to the compact funnel.** Render one extra clause such as `反馈补全：GitHub Issues 5 条 / Product Hunt 评论不可用` only when feedback enrichment was attempted. Never render unavailable as zero feedback.
- [ ] **Step 5: Persist feedback evidence.** For feedback-derived demand, write evidence with `claimType: "user_problem"` for pain/bug patterns or `search_intent` for task/alternative patterns, preserve the raw quote, and include `parentSignalId`/origin in notes. For capability-derived demand, keep `claimType: "search_intent"` and the transformation note.
- [ ] **Step 6: Run report and pipeline tests and verify GREEN.** Run `pnpm exec vitest run tests/report.test.ts tests/pipeline.test.ts`.

## Task 6: Validate against today’s real sources and finish the regression pass

**Files:**
- Inspect: `data/runs/2026-09-01/report.md`
- Inspect: `data/runs/2026-09-01/demand-expressions.json`
- Inspect: `data/runs/2026-09-01/discovery-summary.json`
- Modify only files required by failing checks.

- [ ] **Step 1: Run focused tests and build.** Run:

```bash
pnpm exec vitest run tests/sources/feedback.test.ts tests/demand-expressions.test.ts tests/seed-terms.test.ts tests/candidates.test.ts tests/report.test.ts tests/pipeline.test.ts
pnpm build
```

Expected: all focused tests pass and TypeScript exits 0.
- [ ] **Step 2: Run one real report with existing credentials.** Run:

```bash
pnpm radar -- --date 2026-09-01 --sources producthunt,github,manual,reddit-feed,scys-mcp --input data/runs/2026-09-01/x-web-input.jsonl
```

Record the exit code, entity count, feedback counts, direct demand count, capability-derived count, formal count, and each source status. Do not repeat the run if Product Hunt reports 429.
- [ ] **Step 3: Inspect the report quality.** Verify the top 10 contains a mix of concrete capability terms and direct feedback terms when available; every item has an original quote, source URL, provenance label, and Trends URL. Verify product names remain separate observation items.
- [ ] **Step 4: Run the complete validation.** Run `pnpm test && pnpm build && git diff --check`. Expected: zero test failures, build exit 0, and no whitespace errors.
- [ ] **Step 5: Report limits honestly.** State whether GitHub Issues and Product Hunt comments were available, whether the current token exposed comments, and whether Reddit/SCYS remained unverified. Do not claim user demand where only capability evidence exists.

## Self-review checklist

- [ ] Product descriptions remain first-class capability evidence and can produce Trends candidates.
- [ ] User feedback is a credibility layer and a ranking advantage, not a hard gate for discovering new capability words.
- [ ] Product entities, capability-derived terms, and user-evidence terms have separate labels and IDs.
- [ ] No generated query replaces its original evidence quote.
- [ ] GitHub pull requests, malformed responses, API errors, missing comments, and rate limits are handled as named coverage states.
- [ ] Feedback requests are bounded to the top 20 entities and cached without secrets.
- [ ] The report remains capped at 10 formal terms and 10 observations.
- [ ] Existing dirty worktree changes are preserved; no unrelated files are reset or reverted.
