# SCYS Browser Daily Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable Chrome-login-state SCYS collector and schedule it as a daily radar run.

**Architecture:** A `.mjs` runtime helper drives only the visible SCYS资料库 search UI and returns the existing MCP-shaped transport. The scheduled Codex task imports that helper, runs the existing TypeScript `runRadar`, and writes the daily report; authentication remains inside the browser runtime.

**Tech Stack:** TypeScript radar core, ESM browser helper, Chrome browser-client runtime, Codex daily cron automation.

---

### Task 1: Add the browser runtime helper

**Files:**
- Create: `scripts/scys-browser-runtime.mjs`
- Test: `tests/sources/scys-browser-runtime.test.ts`

- [ ] **Step 1: Write tests for result normalization**

Test the pure normalizer with a title, author, date, and empty body; expect `partial` evidence and a warning that the full detail was not fetched.

- [ ] **Step 2: Implement the helper**

Export `createScysBrowserTransport(tab, options)`; search the visible `请输入关键词` input, click `资料` and `搜索`, read `.information` and matching `.col` cards, and return `items` with the warning. Do not access cookies or storage.

- [ ] **Step 3: Run focused tests**

Run `pnpm test -- tests/sources/scys-browser-runtime.test.ts` and expect the normalization tests to pass.

### Task 2: Document the daily invocation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the exact runtime invocation contract**

Document that the daily task must claim the open SCYS documents tab, import the helper, import `runRadar` through the existing TS runtime, and write to `data/runs/YYYY-MM-DD`.

- [ ] **Step 2: Run build and full tests**

Run `pnpm test && pnpm build && git diff --check`; expect all tests and TypeScript compilation to pass.

### Task 3: Schedule the task

**Files:**
- External Codex automation: `SCYS New Word Radar Daily`

- [ ] **Step 1: Create an active daily automation**

Run at 08:30 Asia/Shanghai with a prompt that claims the existing SCYS login tab, runs the helper for configured queries, verifies source health, and reports the generated report path and candidate titles.

- [ ] **Step 2: Verify the automation configuration**

Read back the automation and verify it is active, daily, targets `/Users/huchenhao/code/website/github/trend-word-2/.worktrees/feature-new-word-radar-mvp`, and does not include credentials.
