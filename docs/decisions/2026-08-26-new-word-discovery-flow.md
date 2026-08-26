# New word discovery flow decision - 2026-08-26

## Decision

The radar uses a recent-first, evidence-first workflow. SCYS recent material is the primary Chinese discovery input; targeted keyword searches, GitHub, Product Hunt, and conditional X/Reddit inputs supplement it. The extractor accepts ordinary-language expressions, not only quoted phrases or hashtags.

## Why

Google Trends is a later confirmation layer for this use case. Social and community language can appear before a measurable Trends curve, so the system must preserve low-confidence early signals and give the user a short manual verification queue instead of rejecting them prematurely.

## Boundaries

- A source failure is not an empty result.
- A title-only entity is a backup candidate unless its description supplies user or problem context.
- The report never claims a term is rising without a manually recorded Google Trends result.
- Browser authentication remains inside the existing logged-in Chrome runtime; no cookies, localStorage, tokens, or profiles are read or persisted.

## Acceptance evidence

- Natural-language extraction and novelty metrics are covered by focused tests.
- Fixture run on 2026-08-26 produced a bounded verification list with source links and manual Trends links.
- Full source-health and persistence tests remain green after the change.
