# Contract: External Fetch-Ledger Retrieval API

Satisfies FR-012 — an externally-accessible interface so systems outside Tome (e.g. the
companion evaluation system in `docs/docs/evaluations/tome_external_eval_design.md`) can
retrieve a run's fetch ledger, independent of Tome's internal evidence-bundle consumers.

## `GET /api/tome/fetch-ledger/{run_id}`

**Auth**: Tome API key (`Authorization: Bearer <key>` or `X-Caipe-Token`, matching the
existing external connector surface at `ui/src/app/api/tome/connector/`), verified via the
existing `verifyTomeApiKey`. The key's owner must have read access to the run's project
(same authorization check already applied to other per-project Tome API surfaces) —
this endpoint does not introduce a new authorization model, only a new resource to check
existing project-level access against.

**Response** `200 OK`:

```json
{
  "run_id": "…",
  "project_id": "…",
  "summary": {
    "fetch_count": 37,
    "success_count": 35,
    "total_bytes_fetched": 482913
  },
  "entries": [
    {
      "id": "…",
      "connector": "github",
      "tool_name": "github_get_issue",
      "tool_args": { "repo": "org/example-repo", "number": 42 },
      "canonical_uri": "github://github.com/org/example-repo/issues/42",
      "status": "success",
      "content": "<exact text returned to the agent>",
      "content_hash": "sha256:...",
      "timestamp": "2026-09-28T00:00:00.000Z"
    }
  ]
}
```

Includes both `status: "success"` and `status: "error"` entries (unlike the evidence-bundle
`source_fetch` items, which per `data-model.md` only surface successes) — an external
consumer verifying completeness (User Story 1 / SC-001) needs to see attempted-but-failed
fetches too, not just what made it into the wiki's evidence.

`summary` is read directly from the run's `RunLedgerSummary` document (FR-013 / SC-006),
not computed from `entries` at request time — so it is present and cheap to read even when
`entries` is large.

**Errors**:
- `401` — missing/invalid API key
- `403` — key valid but not authorized for this run's project
- `404` — no such run, or run has no ledger entries yet

**Retention**: Independent of other evidence data (FR-012) — see `mongodb-migration.md` for
the concrete policy. A `404` after the retention window has elapsed is expected behavior,
not an error condition to alert on.
