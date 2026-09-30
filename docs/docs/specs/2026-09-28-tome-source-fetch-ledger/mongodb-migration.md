# MongoDB Migration: Source-Fetch Provenance Ledger

See [`data-model.md`](./data-model.md) for the full `FetchLedgerEntry` field list.

## Required or no-op

**Required, but additive only.** One new collection is introduced; no existing collection's
schema, indexes, or documents change. No DDL-equivalent change is needed for existing
collections (`tome_evidence_bundles`, `tome_experiments`, etc.) — they are read, not
written, by this feature (per the `source_fetch` kind extension in
`contracts/evidence-bundle-source-fetch-kind.md`).

## New collection: `tome_fetch_ledger_entries`

Named consistently with the existing `tome_<noun>` convention in
`ui/src/lib/tome/evaluation-store.ts` (`tome_evidence_bundles`, `tome_experiments`, etc.).

**Document shape**: one document per `FetchLedgerEntry` (see data-model.md) — not one
document per run, since entries are written incrementally as each tool call resolves
(research.md R3), and a per-run document would require read-modify-write contention across
what may be many fetches in a single run.

**Indexes**:

| Index | Fields | Purpose |
|---|---|---|
| Primary lookup | `{ run_id: 1 }` | External API (`GET /api/tome/fetch-ledger/{run_id}`) and evidence-bundle assembly both fetch by run |
| Project scoping | `{ project_id: 1, run_id: 1 }` | Authorization check (is this run's project one the caller can access) without a second round-trip |
| Content lookup (optional, add if usage shows need) | `{ content_hash: 1 }` | Not required for v1's user stories; only add if a future consumer needs "has this exact content ever been fetched" lookups |

No compound index beyond `{ project_id: 1, run_id: 1 }` is justified by this feature's
query patterns (FR-007's "retrievable as a complete set for a given run" and FR-012's
external retrieval are both single-run lookups).

## New collection: `tome_fetch_ledger_run_summaries`

One document per run (see `data-model.md`'s `RunLedgerSummary`), holding `fetch_count`,
`success_count`, and `total_bytes_fetched`. Kept separate from
`tome_fetch_ledger_entries` deliberately: it's updated via a cheap `$inc`/upsert on every
entry write and read on every summary request (FR-013), whereas entry documents can carry
large `content` payloads that summary reads should never need to scan.

**Indexes**:

| Index | Fields | Purpose |
|---|---|---|
| Primary key | `{ run_id: 1 }` (unique) | One summary per run; upsert target for the `$inc` on each entry write |
| Project scoping | `{ project_id: 1 }` | Same access-control scoping as the entries collection |

**Retention**: Same TTL policy and duration as `tome_fetch_ledger_entries` (below) — a
summary outliving its entries (or vice versa) would be a confusing partial-retention state,
so both collections' TTL indexes use the same `expireAfterSeconds` value, sourced from the
same environment variable.

## Data movement

**None.** This is a forward-only ledger — entries exist only for ingestion runs that occur
after this feature ships (spec.md's Assumptions note this explicitly; there is no
retroactive reconstruction of past runs' fetches, since the raw bytes for those runs were
never captured).

## Retention

FR-012 requires retention independent of other evidence data. Given fetched content can
include sensitive Confluence/Webex material (per spec.md's Assumptions, redaction applies
to *arguments*, not to the retained *content* itself), retention should be bounded rather
than indefinite by default:

**Decision**: Default retention of 180 days (covers the companion evaluation design's
quarterly golden-set refresh cadence in `tome_external_eval_design.md` §5 with margin),
enforced via a MongoDB TTL index on `timestamp` (`expireAfterSeconds`), configurable per
deployment via an environment variable rather than hardcoded — consistent with this repo's
convention of environment-driven configuration (CLAUDE.md: "no secrets/config in source").
This differs from the existing `tome_evidence_bundles`/`tome_experiments` collections, which
have no TTL and rely on manual/admin deletion (`deleteTerminalExperiments`) — a deliberate
difference, since this collection holds raw external content at larger volume than those
collections' LLM-generated text.

**Alternative considered**: No automatic expiry, matching existing collections' manual-
deletion convention. Rejected as the default: unlike evidence bundles (page-store text,
already bounded by wiki size) and experiments (bounded by explicit user action), fetch-
ledger entries accumulate continuously with every ingestion run and retain raw
organization-sensitive content, making unbounded retention a growing, un-reviewed exposure
surface. A TTL index is a well-understood mechanism for exactly this profile.

## Rollback

Additive-only change: dropping the `tome_fetch_ledger_entries` and
`tome_fetch_ledger_run_summaries` collections (and their indexes) fully reverts this
feature's storage footprint with no impact on any other collection.
Because `captureEvidenceBundle`'s `source_fetch` inclusion is conditional on an explicit
`runId` argument (contracts/evidence-bundle-source-fetch-kind.md), reverting the collection
without reverting the application code would simply mean no `source_fetch` items appear
in future bundles (an empty query result), not an error — safe to roll back storage and
application code independently or together.

## Environments

No environment-specific differences are required: the same collection/index/TTL
configuration applies in dev, staging, and prod, with only the TTL duration exposed as an
environment variable for cases where a specific deployment needs a shorter/longer window
(e.g. a dev environment that wants faster cleanup during iteration).
