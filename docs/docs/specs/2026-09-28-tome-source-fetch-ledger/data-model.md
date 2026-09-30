# Data Model: Source-Fetch Provenance Ledger

## FetchLedgerEntry

One record of a single source-system tool call made by the ingestion agent during a run.
Shared wire shape between the agent (`orchestrator/contract.py`) and the backend
(`ui/src/types/tome-evaluation.ts`), following the existing agent/backend contract-sharing
convention already used for `FrozenEvidenceItem`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable id for this entry, e.g. sha256 of `run_id + canonical_uri + timestamp` — same derivation style as existing `EvidenceItem.id` |
| `run_id` | UUID | The ingestion run this fetch belongs to (existing `IngestRequest.run_id`) |
| `project_id` | string | CAIPE project id, for retrieval scoping and access control |
| `connector` | `"github" \| "confluence" \| "webex"` | Which connector made the call — distinct from the evidence-bundle `kind`, which is always `"source_fetch"` for these entries |
| `tool_name` | string | The MCP tool name (e.g. `github_get_issue`) |
| `tool_args` | object | Tool arguments, with free-text fields redacted per connector allowlist (research.md R6); identifier fields (repo, page_id, room_id, numbers) kept verbatim |
| `canonical_uri` | string | Identifies the exact fetched item; reuses the existing per-connector canonical-URI schemes already defined in `ui/src/lib/tome/evidence-bundle.ts` (`github://…`, `confluence://…`, `webex://…`) |
| `status` | `"success" \| "error"` | Whether the fetch returned content or failed |
| `content` | string \| null | The exact bytes/text returned to the agent for this call (post-truncation/pagination). `null` when `status = "error"` |
| `content_hash` | string \| null | sha256 of `content`. `null` when `status = "error"` |
| `error_message` | string \| null | Present only when `status = "error"`; a short, non-sensitive description (e.g. HTTP status) |
| `timestamp` | ISO-8601 string | When the tool call completed |

**Validation rules**:
- `content` and `content_hash` are both present or both absent (tied to `status`).
- `content_hash` MUST equal `sha256(content)` when both are present — enforced by
  computing the hash at the same point `content` is captured, not accepted as
  separately-supplied input.
- `tool_args` MUST NOT contain any field not on that connector's allowlist without
  redaction (enforced by the shared recording helper, not by each connector).

**Relationships**:
- Many `FetchLedgerEntry` records belong to one ingestion run (`run_id`), which already
  exists as a concept via `IngestRequest.run_id` and the existing per-run ingest log
  (`append_log`).
- A `FetchLedgerEntry` is surfaced as one `EvidenceItem` (existing type, extended — see
  below) when a bundle is captured for that run.

## EvidenceItem extension (existing type, additive)

`ui/src/types/tome-evaluation.ts`'s `EvidenceKind` union gains one new member:

```
export type EvidenceKind =
  | "github"
  | "confluence"
  | "webex"
  | "myagent"
  | "wiki"
  | "template"
  | "seed"
  | "project_snapshot"
  | "source_fetch";   // NEW
```

No existing field on `EvidenceItem` changes shape. A `source_fetch` item maps
`FetchLedgerEntry` fields onto the existing `EvidenceItem` shape as follows:

| `EvidenceItem` field | Sourced from |
|---|---|
| `kind` | Always `"source_fetch"` |
| `canonical_uri` | `FetchLedgerEntry.canonical_uri` |
| `content` | `FetchLedgerEntry.content` |
| `content_hash` | `FetchLedgerEntry.content_hash` (recomputed identically — same value) |
| `captured_at` | `FetchLedgerEntry.timestamp` |
| `page_path` | Not set (fetch-ledger entries have no page-store path) |
| `workspace_project_id` | `FetchLedgerEntry.project_id` |

Only `status = "success"` entries produce an `EvidenceItem` (an item with no `content` would
violate `EvidenceItem`'s existing non-nullable `content: string` contract) — failed fetches
remain visible via the ledger's own retrieval endpoint (FR-012) but are not surfaced into
the evidence bundle, since the bundle's existing consumers (the grounding evaluator) have no
use for "we tried and got nothing."

## RunLedgerSummary

Satisfies FR-013 / SC-006. A small, separately-maintained per-run rollup — not computed
on-demand from `FetchLedgerEntry` documents, since summing `content` byte-length across
every entry on every read would mean reading potentially large content blobs just to
answer "how many fetches / how many bytes," which is disproportionate to the question asked.

| Field | Type | Notes |
|---|---|---|
| `run_id` | UUID | One summary document per run |
| `project_id` | string | Mirrors `FetchLedgerEntry.project_id`, for the same access-control scoping |
| `fetch_count` | integer | Total fetches recorded for this run, successful and failed |
| `success_count` | integer | Subset of `fetch_count` where `status = "success"` — kept alongside `fetch_count` since "how many actually returned content" is a natural follow-up to "how many were attempted," and both are cheap to maintain together |
| `total_bytes_fetched` | integer | Sum of `len(content)` (bytes, not characters) across `status = "success"` entries only |
| `updated_at` | ISO-8601 string | Last time this summary was incremented |

**Maintenance**: Updated atomically (`$inc`) in the same backend request that persists each
new `FetchLedgerEntry` (see `contracts/internal-fetch-ledger-callback.md`), rather than
recomputed by scanning entries — an upsert keyed by `run_id` that increments `fetch_count`
(+`success_count`, +`total_bytes_fetched` when the entry is a success) as each entry lands.
This keeps FR-013's "without enumerating and summing every entry" true independent of how
many entries a run eventually has.

**Relationships**: One `RunLedgerSummary` per ingestion run, updated by every
`FetchLedgerEntry` write for that run; read together with (but stored separately from) the
run's entries by both the internal evidence-bundle path and the external retrieval API.

## State transitions

A `FetchLedgerEntry` is created once, at the moment its tool call resolves (success or
error), and is never mutated afterward — matching the existing "frozen evidence" philosophy
in `orchestrator/contract.py`'s `FrozenEvidenceItem`. There is no update path; corrections
require a new ingestion run producing new entries.
