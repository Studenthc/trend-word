# Candidate quality gate decision - 2026-08-27

## Decision

The daily Trends queue is demand-led. A single Product Hunt launch, GitHub repository, or generic feature phrase stays in `观察候选`; a user problem, search-intent expression, or concrete concept with independent corroboration can enter `今天先查`.

## Acceptance

- `AI workflow`, `Workflow automation`, and similar generic feature phrases no longer enter the formal queue.
- Product names such as `FlowPilot` remain visible with explicit missing evidence.
- Concrete user-language expressions remain eligible and are capped at ten.
- Bilingual token aliases are available to clustering without changing legacy expression IDs.
- 190 tests pass and TypeScript build passes.

## Known boundary

The fixture run correctly produced an empty formal queue because its sources contain no qualifying user problem or repeated concrete concept. A real logged-in SCYS run is still required to measure recall on current community language.
