# Source availability decision — 2026-08-24

This decision records the local release-gate runs for the 2026-08-24 radar date. It describes the current implementation and dry-run evidence only; no provider is described as available without an injected transport or captured response.

## Fixture acceptance

Command:

```text
pnpm radar -- --date 2026-08-24 --sources fixtures --workspace /tmp/radar-acceptance
```

Exit code was 0. The report was written to `/tmp/radar-acceptance/data/runs/2026-08-24/report.md`.

| Source | Observed status | Evidence | Tier decision |
| --- | --- | --- | --- |
| scys-mcp | available | fixture signal count 1 | stable fixture coverage |
| producthunt | available | fixture signal count 2 | stable fixture coverage |
| github | available | fixture signal count 1 | stable fixture coverage |
| x-timeline | available | fixture signal count 1 | conditional fixture coverage |
| reddit-feed | partial | one failed HTTP 429 record plus one signal | conditional/degraded |

The fixture report contained source URLs and evidence grades (`direct`) and explicitly stated that failed coverage is not evidence of no new words. It also stated `Google Trends 未验证`.

## Configured dry-run

Command:

```text
pnpm radar -- --date 2026-08-24 --workspace /tmp/radar-configured
```

Exit code was 0. The configured required sources were attempted without implicit network access:

| Source | Observed status | Reason | Tier decision |
| --- | --- | --- | --- |
| scys-mcp | unverified | no injected transport configured | unavailable; configure runtime MCP transport |
| producthunt | unverified | no injected transport configured | unavailable; inject HTTP transport |
| github | unverified | no injected transport configured | unavailable; inject HTTP transport |

No source was converted into a successful empty result. X/Reddit remain conditional and are only queried when handles/communities and injected transports are supplied.

## Google Trends boundary

Google Trends is `manual-or-optional`. The current release does not call an undocumented free API and does not persist credentials. Missing Trends verification leaves candidates in watch/validating states and reports `Google Trends 未验证`; it does not fabricate zero/declining values or delete candidates.

## Release decision

Fixture-first local reporting is accepted. Stable provider availability is not claimed by this gate; configured dry-run availability remains unverified until a runtime transport and real provider response are supplied. Social coverage is not complete by virtue of a successful run.
