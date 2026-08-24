# New Word Opportunity Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first daily radar that discovers new expressions from stable sources, records auditable evidence and source health, and produces a small list of opportunities for manual Google Trends/SERP validation.

**Architecture:** Use a TypeScript ESM CLI with pure domain functions, append-only JSONL raw signals, rebuildable JSON projections, and isolated source adapters. The first usable path is fixtures/manual import → normalization → evidence-aware qualification → Markdown report; stable source adapters follow, while X/Reddit remain best-effort and never block a run.

**Tech Stack:** Node.js 22+, TypeScript, pnpm, Vitest, Zod for runtime validation, native `fetch`, JSON/JSONL files, Markdown output.

---

## Scope and file map

The repository is currently empty apart from the committed product specification. The implementation should create the following focused modules:

```text
package.json
pnpm-lock.yaml
tsconfig.json
vitest.config.ts
README.md
radar.config.json
src/
  cli.ts                  # argument parsing and exit codes
  index.ts                # run orchestration
  types.ts                # public domain and adapter types
  config.ts               # config schema and loading
  storage/jsonl.ts        # append/read JSONL primitives
  storage/run-store.ts    # run artifacts and history paths
  domain/normalize.ts     # expression normalization and fingerprints
  domain/dedupe.ts        # signal and expression dedupe
  domain/lifecycle.ts     # new/watch/rising/stable/fading transitions
  domain/qualification.ts # gates, risk downgrade, missing checks
  domain/evidence.ts      # evidence references and validation
  health/source-health.ts # source availability statuses
  report/markdown.ts      # report rendering
  report/summary.ts       # run summary projection
  sources/source.ts       # adapter contract and safe execution
  sources/fixtures.ts     # deterministic fixture/manual source
  sources/scys-mcp.ts     # official MCP transport boundary
  sources/producthunt.ts  # public launch feed adapter
  sources/github.ts       # public repository/trending adapter
  sources/x-timeline.ts   # known-account best-effort adapter
  sources/reddit-feed.ts  # configured-community best-effort adapter
  sources/google-trends.ts  # optional/manual verification boundary
tests/
  normalize.test.ts
  dedupe.test.ts
  lifecycle.test.ts
  evidence.test.ts
  qualification.test.ts
  source-health.test.ts
  storage.test.ts
  report.test.ts
  pipeline.test.ts
  sources/*.test.ts
```

The source adapters must return `RawSignal` and `SourceHealth` only. They must not construct `Opportunity` records. Domain aggregation remains testable without network access.

## Task 1: Bootstrap the TypeScript CLI

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/cli.ts`
- Create: `src/index.ts`
- Create: `tests/pipeline.test.ts`

- [ ] **Step 1: Create package metadata and scripts**

Use this exact `package.json`:

```json
{
  "name": "new-word-opportunity-radar",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.15.0",
  "scripts": {
    "build": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "radar": "tsx src/cli.ts"
  },
  "dependencies": {
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/node": "^22.15.30",
    "tsx": "^4.19.4",
    "typescript": "^5.8.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Add strict TypeScript settings**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "tests"]
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
    restoreMocks: true,
  },
});
```

- [ ] **Step 3: Write the first failing orchestration test**

Create `tests/pipeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runRadar } from "../src/index.js";

describe("runRadar", () => {
  it("returns a run summary and report projection for fixture input", async () => {
    const result = await runRadar({ date: "2026-08-24", sourceNames: ["fixtures"] });

    expect(result.summary.date).toBe("2026-08-24");
    expect(result.summary.sourcesAttempted).toContain("fixtures");
    expect(result.report).toContain("新词机会雷达");
  });
});
```

- [ ] **Step 4: Run the focused test and verify it fails**

Run: `pnpm install && pnpm test -- tests/pipeline.test.ts`

Expected: FAIL because `src/index.ts` and the domain types do not exist yet.

- [ ] **Step 5: Implement the minimal placeholder orchestration**

Create `src/index.ts` with a temporary fixture-independent result shape:

```ts
export type RadarRunOptions = {
  date: string;
  sourceNames?: string[];
  inputPath?: string;
  workspaceRoot?: string;
};

export type RadarRunResult = {
  summary: { date: string; sourcesAttempted: string[] };
  report: string;
};

export async function runRadar(options: RadarRunOptions): Promise<RadarRunResult> {
  return {
    summary: {
      date: options.date,
      sourcesAttempted: options.sourceNames ?? [],
    },
    report: "# 新词机会雷达\n",
  };
}
```

Create `src/cli.ts`:

```ts
import { runRadar } from "./index.js";

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const result = await runRadar({ date });
process.stdout.write(result.report);
```

- [ ] **Step 6: Run the focused test and build**

Run: `pnpm test -- tests/pipeline.test.ts && pnpm build`

Expected: PASS and TypeScript exits 0.

- [ ] **Step 7: Commit the bootstrap**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts src/cli.ts src/index.ts tests/pipeline.test.ts
git commit -m "chore: bootstrap radar cli"
```

## Task 2: Define runtime-validated domain types

**Files:**
- Create: `src/types.ts`
- Create: `src/config.ts`
- Create: `radar.config.json`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write config and type validation tests**

`tests/config.test.ts` must prove defaults, invalid status values, and non-secret source configuration:

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads safe defaults without requiring provider keys", async () => {
    const config = await loadConfig({ workspaceRoot: "/tmp/does-not-exist" });
    expect(config.sources.required).toEqual(["scys-mcp", "producthunt", "github"]);
    expect(config.sources.bestEffort).toEqual(["x-timeline", "reddit-feed"]);
    expect(config.googleTrends.mode).toBe("manual-or-optional");
  });

  it("rejects an unsupported source health status", async () => {
    await expect(loadConfig({
      workspaceRoot: "/tmp/does-not-exist",
      overrides: { sourceHealthStatus: "success" } as unknown,
    })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Implement the source and domain unions**

`src/types.ts` must define `RawSignal`, `Expression`, `Evidence`, `TrendSnapshot`, `Opportunity`, `ValidationState`, `SourceHealth`, `Engagement`, `AuthorRef`, `Occurrence`, and the adapter contracts from the specification. Keep provider secrets out of all types that are persisted.

The required source and health unions are:

```ts
export type SourceType = "scys-mcp" | "producthunt" | "github" | "x-timeline" | "reddit-feed" | "google-trends" | "manual" | "fixtures";
export type SourceHealthStatus = "available" | "partial" | "blocked" | "empty" | "unverified";
```

- [ ] **Step 3: Implement Zod config parsing**

`src/config.ts` must load `radar.config.json` when present, merge safe defaults, reject unknown health values, and never read API keys from the JSON file. Environment variables are read only inside the adapter that needs them and are never returned by `loadConfig`.

Define `LoadConfigOptions` as `{ workspaceRoot: string; configPath?: string; overrides?: unknown }`; parse `overrides` through the same Zod schema so the invalid-status test exercises the real boundary.

- [ ] **Step 4: Add the initial non-secret config**

Create `radar.config.json`:

```json
{
  "sources": {
    "required": ["scys-mcp", "producthunt", "github"],
    "bestEffort": ["x-timeline", "reddit-feed"],
    "manual": true
  },
  "scys": { "enabled": true, "queries": ["AI", "出海", "风向标"] },
  "producthunt": { "enabled": true, "limit": 50 },
  "github": { "enabled": true, "queries": ["ai tool", "mcp", "agent"], "limit": 30 },
  "xTimeline": { "enabled": false, "handles": [] },
  "redditFeed": { "enabled": false, "communities": [] },
  "googleTrends": { "mode": "manual-or-optional", "region": "US" },
  "report": { "maxActionable": 5, "maxWatch": 20 }
}
```

- [ ] **Step 5: Run tests and commit**

Run: `pnpm test -- tests/config.test.ts && pnpm build`

Expected: PASS and TypeScript exits 0.

```bash
git add src/types.ts src/config.ts radar.config.json tests/config.test.ts
git commit -m "feat: add validated radar domain types"
```

## Task 3: Add append-only storage and rebuildable run artifacts

**Files:**
- Create: `src/storage/jsonl.ts`
- Create: `src/storage/run-store.ts`
- Create: `tests/storage.test.ts`

- [ ] **Step 1: Write storage behavior tests**

The tests must prove that JSONL appends records, malformed lines are reported without silently becoming empty data, run artifacts use the date directory, and failed imports do not replace existing data.

The test file must define its own `createTempRunStore()` helper using `mkdtemp` and pass the resulting directory into `RunStore`; it must not rely on a helper absent from production code. Define `signal(id)` as a small valid `RawSignal` fixture in the test file.

```ts
it("appends and reads raw signals without changing record order", async () => {
  const store = await createTempRunStore();
  await store.appendRawSignals([signal("a"), signal("b")]);
  expect((await store.readRawSignals()).map((item) => item.id)).toEqual(["a", "b"]);
});

it("rejects malformed imported JSONL and preserves the previous file", async () => {
  const store = await createTempRunStore();
  await store.writeProjection("opportunities", [{ id: "keep" }]);
  await expect(store.importJsonl("opportunities", "{bad-json}\n")).rejects.toThrow();
  expect(await store.readProjection("opportunities")).toEqual([{ id: "keep" }]);
});
```

- [ ] **Step 2: Implement atomic projection writes**

`src/storage/jsonl.ts` must provide typed `appendJsonl`, `readJsonl`, and `replaceJson`. Write replacements to a sibling temporary file, rename it over the target only after the complete payload validates, and create parent directories explicitly.

- [ ] **Step 3: Implement `RunStore` paths**

`RunStore` must expose:

```ts
appendRawSignals(signals: RawSignal[]): Promise<void>;
readRawSignals(): Promise<RawSignal[]>;
writeProjection(name: "expressions" | "opportunities" | "evidence" | "run-summary", value: unknown): Promise<void>;
readProjection<T>(name: "expressions" | "opportunities" | "evidence" | "run-summary"): Promise<T | undefined>;
importJsonl(name: "opportunities" | "evidence", content: string): Promise<void>;
writeHistory(value: unknown): Promise<void>;
```

- [ ] **Step 4: Run storage tests and commit**

Run: `pnpm test -- tests/storage.test.ts && pnpm build`

Expected: PASS; no repository data directory should be created by unit tests outside their temporary directory.

```bash
git add src/storage tests/storage.test.ts
git commit -m "feat: add append-only radar storage"
```

## Task 4: Implement normalization, dedupe, lifecycle, and evidence gates

**Files:**
- Create: `src/domain/normalize.ts`
- Create: `src/domain/dedupe.ts`
- Create: `src/domain/lifecycle.ts`
- Create: `src/domain/evidence.ts`
- Create: `src/domain/qualification.ts`
- Create: `tests/normalize.test.ts`
- Create: `tests/dedupe.test.ts`
- Create: `tests/lifecycle.test.ts`
- Create: `tests/evidence.test.ts`
- Create: `tests/qualification.test.ts`

- [ ] **Step 1: Write normalization tests**

Cover Chinese punctuation, Unicode whitespace, case folding for Latin text, URL removal, duplicate aliases, and preservation of the original expression for evidence display.

```ts
it("normalizes equivalent expressions without losing the original text", () => {
  expect(normalizeExpression(" AI  工作流！ ")).toEqual({
    original: " AI  工作流！ ",
    normalized: "ai 工作流",
  });
});
```

- [ ] **Step 2: Write dedupe tests**

Prove that the same URL, external ID, and normalized expression collapse, while two authors from the same source and one author from two reposts do not create independent-source evidence.

- [ ] **Step 3: Write lifecycle tests**

Given previous and current daily observations, assert `new`, `watch`, `rising`, `stable`, and `fading`. A source failure must not create a fading transition.

- [ ] **Step 4: Write evidence and qualification tests**

Define `productHuntSignalFixture()` and `directEvidenceFor(subjectId)` as local test helpers that return valid typed fixtures. Prove these gates:

```ts
it("does not qualify a product-name signal from one publisher", () => {
  const result = qualifyOpportunity({
    signals: [productHuntSignalFixture()],
    evidence: [directEvidenceFor("productHuntSignalFixture")],
    previous: [],
  });
  expect(result.status).toBe("watch");
  expect(result.validation.demand).toBe("single_signal");
});

it("downgrades a candidate when its cited raw signal is missing", () => {
  const result = validateEvidence({ evidenceIds: ["missing"], rawSignals: [] });
  expect(result.valid).toBe(false);
  expect(result.reason).toContain("missing raw signal");
});
```

- [ ] **Step 5: Implement pure domain functions**

Keep domain functions network-free and deterministic:

```ts
normalizeExpression(text: string): { original: string; normalized: string };
dedupeRawSignals(signals: RawSignal[]): RawSignal[];
mergeExpressions(signals: RawSignal[], previous: Expression[]): Expression[];
deriveLifecycle(current: Expression, previous?: Expression): Expression["lifecycle"];
validateEvidence(input: EvidenceValidationInput): EvidenceValidationResult;
qualifyOpportunity(input: QualificationInput): Opportunity;
```

- [ ] **Step 6: Run all domain tests and commit**

Run: `pnpm test -- tests/normalize.test.ts tests/dedupe.test.ts tests/lifecycle.test.ts tests/evidence.test.ts tests/qualification.test.ts && pnpm build`

Expected: PASS; no network requests.

```bash
git add src/domain tests/normalize.test.ts tests/dedupe.test.ts tests/lifecycle.test.ts tests/evidence.test.ts tests/qualification.test.ts
git commit -m "feat: add evidence-aware opportunity qualification"
```

## Task 5: Implement source health and safe adapter execution

**Files:**
- Create: `src/health/source-health.ts`
- Create: `src/sources/source.ts`
- Create: `tests/source-health.test.ts`

- [ ] **Step 1: Write source health tests**

Cover successful items, empty responses, thrown errors, HTTP 403/429, partial multi-endpoint results, and the rule that failed sources are not reported as “no new words”.

```ts
it("maps a 429 to blocked or partial without treating it as empty", async () => {
  const result = await runSafeSource("reddit-feed", async () => {
    throw new Error("HTTP 429 Too Many Requests");
  });
  expect(result.health.status).toBe("blocked");
  expect(result.health.itemCount).toBe(0);
  expect(result.health.coverageNotes.join(" ")).toMatch(/rate|429/i);
});
```

- [ ] **Step 2: Implement the adapter contract**

Define:

```ts
export type SourceAdapter = {
  name: SourceType;
  collect(context: SourceContext): Promise<SourceCollection>;
};

export type SourceCollection = {
  signals: RawSignal[];
  health: SourceHealth;
};
```

`runSafeSource` must catch adapter errors, preserve the original error category in `failureReasons`, and return a result that lets the pipeline continue.

- [ ] **Step 3: Add bounded retry policy**

Retry only transient network failures once with a bounded delay supplied by the adapter context. Do not retry 401, 403, 404, 429, invalid JSON, or missing credentials. No adapter may create an unbounded loop.

- [ ] **Step 4: Run health tests and commit**

Run: `pnpm test -- tests/source-health.test.ts && pnpm build`

Expected: PASS with no external network calls.

```bash
git add src/health src/sources/source.ts tests/source-health.test.ts
git commit -m "feat: make source failures explicit"
```

## Task 6: Build fixture and manual import path

**Files:**
- Create: `src/sources/fixtures.ts`
- Create: `src/sources/manual.ts`
- Create: `tests/sources/fixtures.test.ts`
- Create: `tests/sources/manual.test.ts`
- Create: `fixtures/sample-signals.jsonl`

- [ ] **Step 1: Add realistic fixtures**

Include one 生财-style wind-marker signal, one Product Hunt-style launch, one GitHub-style repository, one X timeline item, one Reddit feed item, a duplicate repost, and a failed source record. Each item must include source, author, timestamp, URL, excerpt, and engagement where available.

- [ ] **Step 2: Write fixture tests**

Prove fixtures are deterministic and feed the same `RawSignal` validator as network adapters. Prove the duplicate is removed only at the domain dedupe stage, not deleted from raw input.

- [ ] **Step 3: Implement manual import**

`manual.ts` must accept JSONL and CSV with explicit aliases for `sourceUrl`, `title`, `body`, `author`, `publishedAt`, and `sourceType`. Invalid rows fail with row numbers; valid previous data remains intact.

- [ ] **Step 4: Run fixture and manual tests**

Run: `pnpm test -- tests/sources/fixtures.test.ts tests/sources/manual.test.ts && pnpm build`

Expected: PASS without network access.

- [ ] **Step 5: Commit the deterministic input path**

```bash
git add src/sources/fixtures.ts src/sources/manual.ts tests/sources fixtures/sample-signals.jsonl
git commit -m "feat: add fixture and manual signal ingestion"
```

## Task 7: Generate the first useful daily report

**Files:**
- Create: `src/report/summary.ts`
- Create: `src/report/markdown.ts`
- Modify: `src/index.ts`
- Modify: `src/cli.ts`
- Create: `tests/report.test.ts`

- [ ] **Step 1: Write report assertions**

The report test must assert the following sections and evidence labels:

```ts
expect(report).toContain("## 来源健康");
expect(report).toContain("## 今日可行动机会");
expect(report).toContain("## 正在验证");
expect(report).toContain("## 新发现但证据不足");
expect(report).toContain("## 风险与失败");
expect(report).toContain("原文证据");
expect(report).toContain("覆盖范围");
```

- [ ] **Step 2: Implement report projections**

`summary.ts` must count sources, signals, expressions, evidence grades, candidate statuses, and failed/partial sources. `markdown.ts` must render source health before opportunity claims so a reader sees coverage limitations first.

- [ ] **Step 3: Wire the fixture run through the full pipeline**

`runRadar` must collect adapters, persist raw signals, dedupe, merge expressions, build evidence, qualify opportunities, write projections, and return the report. A source failure must still produce a report with a nonzero warning count but a zero process exit code when at least one source ran.

- [ ] **Step 4: Add CLI flags**

Support:

```text
pnpm radar -- --date 2026-08-24
pnpm radar -- --sources fixtures,manual
pnpm radar -- --input fixtures/sample-signals.jsonl
pnpm radar -- --workspace /tmp/radar-test
```

Unknown flags exit 2 with a short usage message. A failed required configuration exits 1 after writing the run summary.

- [ ] **Step 5: Run end-to-end local validation**

Run: `pnpm test && pnpm build && pnpm radar -- --date 2026-08-24 --sources fixtures --workspace /tmp/radar-plan-check`

Expected: all tests pass, build exits 0, and the command prints the report path and writes raw signals, projections, summary, and Markdown report under `/tmp/radar-plan-check/data/runs/2026-08-24/`.

- [ ] **Step 6: Commit the first usable local radar**

```bash
git add src/index.ts src/cli.ts src/report tests/report.test.ts README.md
git commit -m "feat: generate evidence-aware daily radar report"
```

## Task 8: Add stable主干 adapters with network-free contract tests

**Files:**
- Create: `src/sources/scys-mcp.ts`
- Create: `src/sources/producthunt.ts`
- Create: `src/sources/github.ts`
- Create: `tests/sources/scys-mcp.test.ts`
- Create: `tests/sources/producthunt.test.ts`
- Create: `tests/sources/github.test.ts`
- Modify: `src/config.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Define transport injection interfaces**

Each adapter accepts a transport function rather than importing a provider client globally:

```ts
export type HttpTransport = (request: {
  url: string;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
}) => Promise<{ status: number; headers: Headers; text(): Promise<string> }>;
```

The MCP adapter must expose an equivalent injected `McpTransport` and must never serialize credentials into `RawSignal`.

- [ ] **Step 2: Write Product Hunt fixture tests**

Parse a saved launch-feed fixture, preserve product URL, maker, launch date, title, tagline, and vote count, and return `partial` when comments are unavailable. A malformed feed returns `failed` with a parse reason.

- [ ] **Step 3: Write GitHub fixture tests**

Parse repository search/trending fixtures, preserve repository URL, owner, description, stars, language, created date, and README excerpt when provided. Map 403 rate-limit responses to `blocked` without returning an empty-success result.

- [ ] **Step 4: Write MCP fixture tests**

Parse content-search and topic-detail fixtures into `RawSignal`. Preserve content ID, title, author, published time, tags, body excerpt, comments/engagement, and permission/sync-delay warnings. Verify a failed MCP call is distinguishable from a valid zero-result query.

- [ ] **Step 5: Implement adapters and register required sources**

The stable adapters must be enabled by default from `radar.config.json`, but tests and local runs must be able to inject fixtures. If a required source is unavailable, the run continues and marks the source health as `blocked` or `unverified`; it does not invent signals.

- [ ] **Step 6: Run adapter tests and commit**

Run: `pnpm test -- tests/sources/scys-mcp.test.ts tests/sources/producthunt.test.ts tests/sources/github.test.ts && pnpm build`

Expected: PASS without network access.

```bash
git add src/sources/scys-mcp.ts src/sources/producthunt.ts src/sources/github.ts src/config.ts src/index.ts tests/sources
git commit -m "feat: add stable radar source adapters"
```

## Task 9: Add conditional X and Reddit adapters without global-search dependency

**Files:**
- Create: `src/sources/x-timeline.ts`
- Create: `src/sources/reddit-feed.ts`
- Create: `tests/sources/x-timeline.test.ts`
- Create: `tests/sources/reddit-feed.test.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Write X timeline tests**

Parse known-account timeline fixtures. Prove that an unavailable account produces `partial`, that an empty account produces `empty`, and that the adapter never reports “no X trends” for accounts it did not query. Global search must not exist in this adapter’s contract.

- [ ] **Step 2: Write Reddit feed tests**

Parse configured community RSS/page fixtures. Prove separate handling for 403, 429, timeout, valid empty feed, and valid posts. A single community failure must not prevent other communities from being collected.

- [ ] **Step 3: Implement bounded best-effort adapters**

Use configured handles/communities only. Apply the shared source executor, one bounded transient retry, and per-endpoint health aggregation. Never use a failed endpoint as evidence of absence.

- [ ] **Step 4: Run conditional adapter tests and commit**

Run: `pnpm test -- tests/sources/x-timeline.test.ts tests/sources/reddit-feed.test.ts && pnpm build`

Expected: PASS without external network access.

```bash
git add src/sources/x-timeline.ts src/sources/reddit-feed.ts src/config.ts tests/sources
git commit -m "feat: add best-effort social source adapters"
```

## Task 10: Add Google Trends verification boundary and final docs

**Files:**
- Create: `src/sources/google-trends.ts`
- Create: `tests/sources/google-trends.test.ts`
- Modify: `src/domain/qualification.ts`
- Modify: `src/report/markdown.ts`
- Modify: `README.md`

- [ ] **Step 1: Write Google Trends boundary tests**

Cover manual verification records, unavailable provider, partial response, multiple windows, region, related queries, and stale snapshots. Do not test or depend on an undocumented free API.

```ts
it("keeps a manually captured Trends snapshot as verification evidence", () => {
  const snapshot = parseManualTrendsSnapshot({
    expression: "new ai tool",
    capturedAt: "2026-08-24T09:00:00.000Z",
    window: "24h",
    region: "US",
    value: 82,
    status: "verified",
  });
  expect(snapshot.provider).toBe("google_trends");
  expect(snapshot.window).toBe("24h");
});
```

- [ ] **Step 2: Implement optional/manual provider boundary**

`google-trends.ts` must support `manual-or-optional` mode. It returns `unverified` when no provider is configured, stores no credentials, and never prevents social discovery or report generation.

- [ ] **Step 3: Make Trends evidence additive**

Qualification may upgrade confidence when a valid Trends snapshot exists, but a missing Trends snapshot must leave a social-first candidate in `watch` or `validating`, not delete it. The report must state “Google Trends 未验证” rather than imply a declining or zero trend.

- [ ] **Step 4: Document the real daily workflow**

README must show:

```text
1. Configure scys MCP access in the local runtime.
2. Run the radar with fixture mode first.
3. Review source health before reading opportunities.
4. Open the candidate in Google Trends manually when needed.
5. Record the Trends snapshot and the decision: keep, pause, reject, or execute.
```

It must document that X/Reddit coverage is conditional and that a successful run does not mean complete social coverage.

- [ ] **Step 5: Run the complete validation suite**

Run: `pnpm test && pnpm build && git diff --check`

Expected: all tests pass, TypeScript exits 0, and `git diff --check` produces no output.

- [ ] **Step 6: Commit the optional verifier and documentation**

```bash
git add src/sources/google-trends.ts src/domain/qualification.ts src/report/markdown.ts README.md tests/sources/google-trends.test.ts
git commit -m "feat: add optional google trends verification"
```

## Task 11: Final release gate

**Files:**
- Modify: `README.md`
- Create: `docs/decisions/2026-08-24-source-availability.md`

- [ ] **Step 1: Run the fixture-only acceptance command**

Run: `pnpm radar -- --date 2026-08-24 --sources fixtures --workspace /tmp/radar-acceptance`

Expected:

- exit code 0;
- a Markdown report exists;
- source health includes `available` and at least one explicit degraded/empty case from the fixtures;
- every listed candidate has a source URL and evidence grade;
- no secrets appear in any generated file.

- [ ] **Step 2: Run the configured-source dry run**

Run: `pnpm radar -- --date 2026-08-24 --workspace /tmp/radar-configured`

Expected: the command either collects configured public sources or writes explicit `blocked`, `partial`, `empty`, or `unverified` health records. It must not turn unavailable sources into successful empty results.

- [ ] **Step 3: Review the generated report manually**

Check the report in this order:

1. source health and coverage notes;
2. raw source links and timestamps;
3. candidate qualification status;
4. missing checks;
5. next manual Google Trends/SERP action.

- [ ] **Step 4: Record the availability decision**

Create `docs/decisions/2026-08-24-source-availability.md` with the actual run date, each source status, endpoint/adapter used, failures, and whether the source remains in stable, conditional, or deferred tier. Do not describe an untested provider as available.

- [ ] **Step 5: Commit the release gate evidence**

```bash
git add README.md docs/decisions/2026-08-24-source-availability.md
git commit -m "docs: record radar source availability gate"
```

## Verification checklist

Before claiming the MVP is complete, verify all of the following:

- [ ] `pnpm test` passes.
- [ ] `pnpm build` passes.
- [ ] `git diff --check` is clean.
- [ ] Fixture-only radar produces a report with evidence and source health.
- [ ] At least one source failure path is visible and non-fatal.
- [ ] X/Reddit are not required for a successful run.
- [ ] Google Trends is optional/manual and never silently replaced by Suggest.
- [ ] No Cookie, MCP key, API key, or private token is persisted.
- [ ] The report never equates an unavailable source with no demand.
- [ ] The user can select a candidate and manually verify it in Google Trends.
