# Tasks: Source-Fetch Provenance Ledger

**Input**: Design documents from `docs/docs/specs/2026-09-28-tome-source-fetch-ledger/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, mongodb-migration.md, quickstart.md

**Tests**: Included. This repo's constitution ("VI. CI Gates Are Non-Negotiable") and existing
`tome_agent`/`ui` test coverage make tests the norm here, not an opt-in.

**Organization**: Tasks are grouped by user story (spec.md P1/P2/P3) so each is independently
implementable, testable, and deployable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no unresolved dependency)
- **[Story]**: US1 / US2 / US3, per spec.md's priorities

## Path Conventions

Two existing components, no new ones:
- Agent (Python): `ai_platform_engineering/agents/tome/tome_agent/`, tests in
  `ai_platform_engineering/agents/tome/tests/`
- Backend/BFF (TypeScript/Next.js): `ui/src/`, tests co-located in `__tests__/` per
  CLAUDE.md's "tests live beside their component" rule

---

## Phase 1: Setup

**Purpose**: Configuration groundwork used by later phases. No new service/project — both
components already exist.

- [x] T001 [P] Add `TOME_FETCH_LEDGER_RETENTION_DAYS` (default `180`) to `ui/env.example`,
      per `mongodb-migration.md`'s retention decision
- [x] T002 [P] Document the fetch ledger's purpose, the `source_fetch` evidence kind, and
      the new external retrieval endpoint in
      `ai_platform_engineering/agents/tome/README.md` (component README, per CLAUDE.md docs
      rules) — placeholder section, filled in fully once Foundational + US1 land

**Checkpoint**: No functional change yet; env var and doc scaffold exist.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared wire contract, storage, recording mechanism, and internal callback
that every user story depends on. **No connector is wired to this yet** — that's US1/US2.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T003 Add `FetchLedgerEntry` pydantic model to
      `ai_platform_engineering/agents/tome/tome_agent/orchestrator/contract.py`, per
      `data-model.md` (fields: `run_id`, `project_id`, `connector`, `tool_name`,
      `tool_args`, `canonical_uri`, `status`, `content`, `content_hash`, `error_message`,
      `timestamp`), alongside the existing `FrozenEvidenceItem`
- [x] T004 [P] Add matching `FetchLedgerEntry` and `RunLedgerSummary` TypeScript interfaces
      to `ui/src/types/tome-evaluation.ts`, and add `"source_fetch"` to the `EvidenceKind`
      union (per `data-model.md`'s EvidenceItem extension) — additive only, no existing
      type's fields change
- [x] T005 Add the shared `record_fetch(...)` recording helper to
      `ai_platform_engineering/agents/tome/tome_agent/agent/connectors/base.py`: takes
      connector name, tool name, raw args, a per-connector redaction allowlist, the
      canonical URI, and either the successful payload or the exception that occurred;
      returns the same `_ok()`-shaped MCP tool result while also constructing a
      `FetchLedgerEntry` (computing `content_hash` from the exact outgoing text per
      `research.md` R2, redacting non-allowlisted `tool_args` fields to a placeholder) and
      handing it off for persistence — depends on T003
- [x] T006 Add `append_fetch_ledger_entry(run_id, entry)` to
      `ai_platform_engineering/agents/tome/tome_agent/agent/http_client.py`, mirroring the
      existing `append_log`/`append_log_sync` pattern exactly (POST to the new internal
      route, log-and-continue on failure, never raise) — depends on T003
- [x] T007 Thread `run_id` (already present on `IngestRequest`) so `record_fetch()` can
      attribute each entry to the correct run — depends on T005. **Implemented differently
      than planned**: rather than passing `run_id` through `build_mcp()`'s call chain in
      `ingestor.py` (which would require changing every connector's `build_mcp` signature),
      added a `set_active_run_id`/`get_active_run_id` contextvar pair to `http_client.py`
      (matching the existing `set_active_project_id`/`set_active_experiment` pattern) and
      set it in `main.py`'s `/ingest`, `/compact`, and `/synthesize` endpoint handlers. Left
      unset for `/chat`, so chat's connector calls correctly produce no ledger entries.
- [x] T008 [P] Create `ui/src/lib/tome/fetch-ledger-store.ts`: Mongo persistence following
      `ui/src/lib/tome/folder-store.ts`'s lazy `indexesReady` pattern — collections
      `tome_fetch_ledger_entries` (`{run_id:1}`, `{project_id:1,run_id:1}`, TTL index on
      `timestamp` using `TOME_FETCH_LEDGER_RETENTION_DAYS`) and
      `tome_fetch_ledger_run_summaries` (unique `{run_id:1}`, `{project_id:1}`, same TTL);
      exports `insertFetchLedgerEntry`, `upsertRunLedgerSummary` (atomic `$inc` of
      `fetch_count`/`success_count`/`total_bytes_fetched`), `getFetchLedgerEntries(runId)`,
      `getRunLedgerSummary(runId)` — depends on T004
- [x] T009 Implement the internal callback route
      `ui/src/app/api/tome/api/internal/projects/[id]/runs/[runId]/fetch-ledger/route.ts`:
      `POST` validates the body against `FetchLedgerEntry`, re-validates that `tool_args`
      contains no un-redacted non-allowlisted field (defense in depth — do not trust the
      agent's redaction alone, per Constitution VII), calls `insertFetchLedgerEntry` and
      `upsertRunLedgerSummary` in the same request, returns `204` — depends on T008
- [x] T010 [P] pytest: `record_fetch()` unit tests in
      `ai_platform_engineering/agents/tome/tests/test_fetch_ledger.py` — success path
      (content hash correctness, redaction applied to non-allowlisted args, callback
      invoked with correct `FetchLedgerEntry`), error path (exception → `status="error"`
      entry with no `content`/`content_hash`), and that a callback failure is logged but
      does not raise — depends on T005, T006
- [x] T011 [P] Jest: `fetch-ledger-store.ts` unit tests in
      `ui/src/lib/tome/__tests__/fetch-ledger-store.test.ts` — index creation, entry insert,
      `RunLedgerSummary` upsert increments (`fetch_count` always, `success_count` +
      `total_bytes_fetched` only on success) — depends on T008
- [x] T012 [P] Jest: internal callback route tests in
      `ui/src/app/api/tome/api/internal/projects/[id]/runs/[runId]/fetch-ledger/__tests__/route.test.ts`
      — valid entry persisted, malformed body rejected, un-redacted sensitive arg rejected
      — depends on T009

**Checkpoint**: Recording mechanism, storage, and internal persistence path exist and are
independently testable — but no connector produces entries yet.

---

## Phase 3: User Story 1 - Verify a generated claim against what was actually fetched (Priority: P1) 🎯 MVP

**Goal**: For GitHub fetches, every tool call produces a ledger entry with real content and
a verifiable hash, retrievable through a new external API (with summary counts), so a claim
can be checked against what was actually fetched.

**Independent Test**: Run an ingestion against a GitHub-only project, capture raw HTTP
responses independently, then confirm via the new external API that every logged entry's
content hash matches the independently-captured response (spec.md US1's Independent Test).

### Tests for User Story 1

- [x] T013 [P] [US1] pytest: wire a stub GitHub MCP tool call through `record_fetch()` and
      assert the resulting entry's `canonical_uri`, `content`, and `content_hash` are
      correct for a known fixture response, in
      `ai_platform_engineering/agents/tome/tests/test_fetch_ledger.py` (extends T010's file)
- [x] T014 [P] [US1] Jest: contract test for `GET /api/tome/fetch-ledger/[runId]` in
      `ui/src/app/api/tome/fetch-ledger/[runId]/__tests__/route.test.ts` — 401 (no/invalid
      key), 403 (valid key, wrong project), 404 (unknown run), 200 happy path including
      `summary.fetch_count`/`summary.total_bytes_fetched`

### Implementation for User Story 1

- [x] T015 [US1] Wire `mcp_github.py`'s tool functions to call `record_fetch()`
      (connectors/base.py, T005) in place of the module's local `_ok()`/`_err()` helpers —
      depends on T005, T007
- [x] T016 [US1] Define GitHub's redaction allowlist (`repo`, `number`, `ref`, `path`,
      `project_number` kept verbatim; `query` in `github_search_issues` and any other
      free-text argument redacted) and pass it into `record_fetch()` calls in `mcp_github.py`
      — depends on T015
- [x] T017 [US1] Add a canonical-URI builder for GitHub tool calls in `mcp_github.py` (or a
      shared helper in `connectors/github.py`), matching the `github://` scheme already
      defined agent-independently in `ui/src/lib/tome/evidence-bundle.ts`'s
      `canonicalPageUri` — depends on T015
- [x] T018 [US1] Implement `GET /api/tome/fetch-ledger/[runId]/route.ts`: verify the Tome
      API key (`verifyTomeApiKey`), check the key owner's access to the run's project
      (reuse the existing per-project authorization check used by
      `ui/src/app/api/tome/connector/`), call `getFetchLedgerEntries` +
      `getRunLedgerSummary`, return the shape in
      `contracts/external-fetch-ledger-api.md` (both `status: "success"` and
      `status: "error"` entries, plus `summary`) — depends on T008, T014
- [ ] T019 [US1] Integration check: run ingestion against a GitHub-only fixture project,
      independently re-fetch one cited item, and confirm hash equality per
      `quickstart.md`'s User Story 1 steps — manual/CI smoke step, not a new unit test.
      **Not run**: requires a live Docker Compose stack, a real GitHub token, and a
      configured project — outside this implementation pass's environment. Unit/component
      tests (T010, T013, T014) cover the same logic with fixtures; a human reviewer should
      run this against a real deployment before considering US1 fully verified end-to-end.

**Checkpoint**: GitHub fetches are ledgered end-to-end and externally retrievable with
content, hash, and per-run summary counts — deployable as a standalone increment.

---

## Phase 4: User Story 2 - New or modified connectors cannot silently skip the ledger (Priority: P2)

**Goal**: Confluence and Webex are wired through the exact same shared helper with zero
connector-specific ledger code beyond their own redaction allowlist and canonical-URI
mapping, and the "no opt-out" guarantee is demonstrated generically (not just asserted).

**Independent Test**: Point a connector's fetch calls at a stub/mocked source, or add a
minimal test-only connector, without writing any connector-specific ledger code, and confirm
ledger entries still appear (spec.md US2's Independent Test).

### Tests for User Story 2

- [x] T020 [P] [US2] pytest: minimal stub connector routed through `record_fetch()` with no
      ledger-specific code in the stub itself still produces complete entries (SC-003), in
      `ai_platform_engineering/agents/tome/tests/test_fetch_ledger.py`
- [x] T021 [P] [US2] pytest: repeated/overlapping fetches of the same content in one run
      each produce independent ledger entries (Edge Case: Repeated or overlapping fetches),
      same file

### Implementation for User Story 2

- [x] T022 [P] [US2] Wire `mcp_confluence.py`'s tool functions to `record_fetch()`, replacing
      its local `_ok()`/`_err()` helpers — depends on T005, T007
- [x] T023 [P] [US2] Wire `mcp_webex.py`'s tool functions to `record_fetch()`, replacing its
      local `_ok()`/`_err()` helpers — depends on T005, T007
- [x] T024 [P] [US2] Define Confluence's redaction allowlist (`page_id`, `space_key` kept
      verbatim; any CQL/free-text filter argument redacted) and canonical-URI builder
      (matching the `confluence://` scheme in `evidence-bundle.ts`) — depends on T022
- [x] T025 [P] [US2] Define Webex's redaction allowlist (`room_id`, `message_id` kept
      verbatim; free-text search/message-body arguments redacted) and canonical-URI builder
      (matching the `webex://` scheme in `evidence-bundle.ts`) — depends on T023
- [x] T026 [US2] pytest: failed-fetch handling — force a tool call to raise/error for each
      of GitHub, Confluence, and Webex, and assert a `status="error"` entry with no
      `content`/`content_hash` is recorded (Edge Case: Failed or errored fetch) — depends on
      T015, T022, T023

**Checkpoint**: All three connectors covered by the shared boundary; adding a fourth
connector requires no new ledger code, only wiring its tool functions to `record_fetch()`.

---

## Phase 5: User Story 3 - Consume fetch records without confusing them for generated pages (Priority: P3)

**Goal**: `captureEvidenceBundle` can surface a run's successful fetches as `source_fetch`
evidence items, without changing any existing evidence kind's behavior.

**Independent Test**: Request the evidence bundle for a completed run and confirm raw fetch
records appear as their own distinct kind, with no existing kind's items altered (spec.md
US3's Independent Test).

### Tests for User Story 3

- [x] T027 [P] [US3] Jest regression test: `captureEvidenceBundle` called without `runId`
      produces byte-identical `items` (same `content`/`content_hash` per existing kind) to
      pre-feature behavior, in `ui/src/lib/tome/__tests__/evidence-bundle.test.ts`
      (FR-009/SC-004)
- [x] T028 [P] [US3] Jest test: `captureEvidenceBundle` called with `runId` includes one
      `source_fetch` item per `status: "success"` ledger entry for that run, and none for
      `status: "error"` entries, same file

### Implementation for User Story 3

- [x] T029 [US3] Add optional `runId?: string` parameter to `captureEvidenceBundle` in
      `ui/src/lib/tome/evidence-bundle.ts`; when present, call
      `getFetchLedgerEntries(runId)` (T008), filter to `status: "success"`, and append one
      `EvidenceItem` per entry with `kind: "source_fetch"` per `data-model.md`'s mapping
      table — depends on T008, T027
- [x] T030 [US3] Investigated all three existing callers
      (`ingest-runner.ts`, `experiment-runner.ts`, `myagent-tool.ts`). **No caller changed**:
      every existing `captureEvidenceBundle` call captures the bundle *before* the run's
      connector fetches happen (it's the pre-run frozen-evidence baseline the design doc's
      §2.1 describes), so at their capture point `getFetchLedgerEntries(runId)` would
      always return `[]` — passing `runId` there would be a harmless no-op, not a real
      inclusion, and would misleadingly suggest those call sites intentionally include
      fetches. The capability is real and independently verified (T027/T028); a future
      caller capturing a bundle *after* a run completes (e.g. for a source-fidelity review)
      is what would actually exercise it.

**Checkpoint**: All three user stories independently functional; evidence-bundle consumers
can distinguish raw fetches from LLM-authored pages.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T031 [P] Finish the `ai_platform_engineering/agents/tome/README.md` section started
      in T002 with the shipped behavior (recording mechanism, redaction, retention,
      external endpoint)
- [x] T032 [P] Update `docs/docs/evaluations/tome_external_eval_design.md` §6.1's "Status"
      line from "proposed, not committed" to reflect that the ledger has landed, so the
      companion design doc doesn't go stale against this repo's own delivered feature
- [x] T033 Ran `ruff check` (new code clean; pre-existing findings in untouched files
      unaffected) and the full `tests/` suite (155 pre-existing + 20 new tests, all pass)
      for `ai_platform_engineering/agents/tome/`; ran `npm run lint` (clean), `tsc --noEmit`
      (no new errors; pre-existing missing-module errors in unrelated files unaffected), and
      the new/changed Jest suites (18 new tests, all pass; 5 unrelated pre-existing suite
      failures from missing `unpdf`/`pdfkit`/mcpb-bundle packages in this environment) for
      `ui/`
- [ ] T034 Execute `quickstart.md` end-to-end against the local Docker Compose dev stack
      (`docker-compose.tome.yaml`) for all three user stories. **Not run**: no live Docker
      Compose stack, MongoDB, or real GitHub/Confluence/Webex credentials available in this
      implementation pass — same constraint as T019. Recommended before merging.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup (T001's retention env var feeds T008's TTL
  index) — **BLOCKS all user stories**
- **User Story 1 (Phase 3)**: Depends on Foundational — no dependency on US2/US3
- **User Story 2 (Phase 4)**: Depends on Foundational — independent of US1, but naturally
  follows it since US1 proves the shared-helper pattern on one connector first
- **User Story 3 (Phase 5)**: Depends on Foundational (T008) — independent of US1/US2's
  connector wiring, since it consumes whatever ledger entries already exist regardless of
  which connectors produced them
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### Within Each Phase

- Wire contract/types (T003, T004) before the helper/store that use them (T005, T008)
- The recording helper (T005) before any connector wiring (T015, T022, T023)
- Storage (T008) before the internal route (T009) and evidence-bundle integration (T029)
- Tests for a phase can be written alongside or just before its implementation tasks;
  mark tasks `[P]` only where files don't overlap

### Parallel Opportunities

- T001/T002 (Setup) in parallel
- T004 (TS types) in parallel with T003 (Python schema) — different components
- T008 (Mongo store) in parallel with T005/T006/T007 (agent-side) once T003/T004 land
- T010, T011, T012 (foundational tests) in parallel once their respective implementation
  tasks land
- T022/T023/T024/T025 (Confluence + Webex wiring, US2) fully parallel — different files,
  no shared state
- T027/T028 (US3 tests) in parallel

---

## Parallel Example: Foundational Phase

```bash
# After T003 and T004 land, these can run together:
Task: "Add record_fetch() helper to connectors/base.py"                    # T005
Task: "Create ui/src/lib/tome/fetch-ledger-store.ts"                       # T008
```

## Parallel Example: User Story 2

```bash
Task: "Wire mcp_confluence.py to record_fetch()"                          # T022
Task: "Wire mcp_webex.py to record_fetch()"                               # T023
Task: "Define Confluence redaction allowlist + canonical-URI builder"     # T024
Task: "Define Webex redaction allowlist + canonical-URI builder"          # T025
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) + Phase 2 (Foundational)
2. Complete Phase 3 (User Story 1) — GitHub fetches ledgered, externally retrievable
3. **STOP and VALIDATE**: run `quickstart.md`'s User Story 1 steps independently
4. This alone unblocks the companion evaluation design's GitHub-sourced Source Fidelity
   checks (`tome_external_eval_design.md` §6.1) even before Confluence/Webex are wired

### Incremental Delivery

1. Setup + Foundational → mechanism and storage exist, nothing wired yet
2. + User Story 1 → GitHub covered, external API live → validate → ship (MVP)
3. + User Story 2 → Confluence + Webex covered, no-opt-out guarantee proven → validate → ship
4. + User Story 3 → evidence-bundle `source_fetch` kind available to consumers → validate → ship
5. + Polish → docs, lint/test gates, full quickstart pass

---

## Notes

- `[P]` tasks touch different files with no unresolved dependency on an incomplete task in
  this list.
- Every connector-wiring task (T015, T022, T023) replaces that module's local `_ok()`/`_err()`
  call sites rather than adding a parallel logging path — there should be exactly one way
  for a tool result to leave any `mcp_*.py` module once these land.
- Commit after each task or logical group; stop at any phase checkpoint to validate that
  phase's user story independently before continuing.
