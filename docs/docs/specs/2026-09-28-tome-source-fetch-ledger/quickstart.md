# Quickstart: Source-Fetch Provenance Ledger

## Verify User Story 1 (a fetch's ledger entry matches real source content)

1. Trigger an ingestion run for a project with at least one GitHub source configured.
2. Once the run completes, note its `run_id` (visible in the existing ingest log stream).
3. Call `GET /api/tome/fetch-ledger/{run_id}` with a valid Tome API key scoped to that
   project.
4. Pick one `github` entry from the response and independently fetch the same URL/API
   call (e.g. via `curl` against the GitHub API directly, using the same ref/path).
5. Confirm `sha256(<your independent fetch's response body>) == entry.content_hash`, and
   that `entry.content` matches that body verbatim (accounting for the same
   truncation/pagination the original tool call applied, per `research.md` R2).

## Verify User Story 2 (no connector can skip the ledger)

1. In `mcp_github.py` (or `mcp_confluence.py` / `mcp_webex.py`), confirm every tool function
   returns via the shared `connectors/base.py` recording helper, not a local `_ok()`/`_err()`.
2. Run the ingestion agent's existing test suite
   (`uv run pytest ai_platform_engineering/agents/tome/tests/test_fetch_ledger.py`) — it
   should assert that calling any registered tool produces exactly one ledger entry, without
   the test needing to configure anything connector-specific.

## Verify User Story 3 (evidence bundle keeps kinds distinct)

1. Launch a model-evaluation experiment for a project that has completed an ingestion run
   (existing experiment flow), passing that run's `run_id` when the bundle is captured.
2. Inspect the resulting `EvidenceBundle.items` and confirm:
   - Items with `kind: "source_fetch"` exist, one per successful fetch in that run.
   - Every pre-existing `github`/`confluence`/`webex`/`wiki`/`template`/`seed`/
     `project_snapshot` item is present with the exact same `content`/`content_hash` it
     would have had before this feature (diff against a bundle captured without `runId`
     for the same project state).

## Local development notes

- Both `tome_agent` (Python) and `ui` (Next.js) changes are needed for an end-to-end test —
  see `plan.md`'s Project Structure for the exact files on each side.
- No new service or container is introduced; run the existing Docker Compose dev stack
  (`docker-compose.tome.yaml`) as usual.
