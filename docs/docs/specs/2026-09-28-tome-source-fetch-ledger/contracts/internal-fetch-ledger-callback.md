# Contract: Internal Agent → Backend Fetch-Ledger Callback

Mirrors the existing internal callback shape documented in
`ai_platform_engineering/agents/tome/tome_agent/orchestrator/contract.py`
(`POST /internal/projects/{id}/runs/{run_id}/log`).

## `POST /api/internal/projects/{project_id}/runs/{run_id}/fetch-ledger`

Called by `tome_agent`'s shared fetch-recording helper (`connectors/base.py`), once per
completed tool call, immediately after that call resolves — not batched.

**Auth**: Same internal agent→backend trust boundary already used by `append_log` and the
persist hook (not the external API-key mechanism — this is agent-to-backend, not
outside-caller-to-backend).

**Request body** (`FetchLedgerEntry`, minus `id`/`project_id`/`run_id`, which the route
derives from the URL/session rather than trusting the body):

```json
{
  "connector": "github",
  "tool_name": "github_get_issue",
  "tool_args": { "repo": "org/example-repo", "number": 42 },
  "canonical_uri": "github://github.com/org/example-repo/issues/42",
  "status": "success",
  "content": "<exact text returned to the agent>",
  "content_hash": "sha256:...",
  "error_message": null,
  "timestamp": "2026-09-28T00:00:00.000Z"
}
```

**Server-side effect**: In the same request, the backend upserts that run's
`RunLedgerSummary` document (`tome_fetch_ledger_run_summaries`), incrementing
`fetch_count` (always) and `success_count` + `total_bytes_fetched` (only when
`status = "success"`, using `len(content)` from this request body) — see
`data-model.md`'s `RunLedgerSummary` and `mongodb-migration.md`. This keeps the summary
correct incrementally without a separate reconciliation step.

**Response**: `204 No Content` on success.

**Failure handling**: A non-2xx response or network error is logged as a warning by the
agent (matching `append_log_sync`'s existing behavior) and does not raise — a lost ledger
write must never fail or stall ingestion.

**Idempotency**: Not required. Each tool call produces exactly one POST; retried delivery
after a transient failure is acceptable to skip (best-effort), matching the existing
`append_log` posture, since this is a provenance record, not a correctness-critical write
path for the wiki itself.

**Known gap against spec.md SC-001**: SC-001 states 100% of fetches get a ledger entry.
Best-effort delivery means a callback POST that fails (backend unreachable, transient
network error) produces a completed tool call with no corresponding entry — a real, if
rare, gap against that 100% target. This mirrors an accepted risk already present in
`append_log`'s identical failure handling. If this gap proves unacceptable in practice
(e.g. surfaced by monitoring the delivery failure rate), the mitigation is a bounded retry
with backoff in the agent's HTTP client before giving up — not a synchronous/blocking write,
which would violate the "no user-visible ingestion slowdown" performance goal in plan.md.

