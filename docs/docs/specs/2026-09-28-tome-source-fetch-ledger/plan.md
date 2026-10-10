# Implementation Plan: Source-Fetch Provenance Ledger

**Branch**: `2026-09-28-tome-source-fetch-ledger` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/2026-09-28-tome-source-fetch-ledger/spec.md`

## Summary

Tome's ingestion agent fetches GitHub, Confluence, and Webex content through per-connector
MCP tool functions (`mcp_github.py`, `mcp_confluence.py`, `mcp_webex.py`), but nothing
records what was actually fetched — only the LLM's own citations in generated wiki pages,
which are themselves interpretive summaries, not mirrors (per
`docs/docs/evaluations/tome_external_eval_design.md` §2.1–§2.2). This feature adds a
per-run **fetch ledger**: a single shared recording point that every connector's tool calls
pass through, capturing canonical URI, full fetched content, a sha256 hash of that content,
timestamp, and (redacted) tool name/args — regardless of whether the LLM cites the content.
Ledger entries are persisted via the existing agent→backend internal-callback pattern
(`http_client.append_log`-style), stored in a new MongoDB collection, exposed through a new
`source_fetch` evidence-bundle kind (distinct from the existing LLM-authored
`github`/`confluence`/`webex` page kinds), and retrievable through a new externally-facing,
API-key-authenticated endpoint for consumers outside Tome (e.g. the companion evaluation
system).

## Technical Context

**Language/Version**: Python 3.11+ (`tome_agent`, connector/MCP layer) and TypeScript 5 /
Next.js (App Router) for the backend BFF (`ui/`)
**Primary Dependencies**: Claude Agent SDK (`create_sdk_mcp_server`, `tool`) and `httpx` on
the agent side; `pydantic` for the shared `ttt-backend`/`ttt-agent` wire contract
(`orchestrator/contract.py`); Next.js API routes, the existing MongoDB driver wrapper
(`@/lib/mongodb`), and the existing Tome API-key auth (`ui/src/lib/tome-api-keys.ts`) on the
backend side
**Storage**: MongoDB — new collection for fetch-ledger entries, alongside the existing
`tome_evidence_bundles` / `tome_experiments` collections in `ui/src/lib/tome/evaluation-store.ts`
**Testing**: `pytest` (`ai_platform_engineering/agents/tome/tests/`, run via `uv run pytest`)
for the agent/connector side; Jest (`ui/src/lib/tome/__tests__/`, `ui/src/app/api/**/__tests__/`)
for the Next.js side
**Target Platform**: Linux containers — the existing `tome_agent` container and the existing
Next.js `ui` server, both already deployed via this repo's Docker Compose / Helm setup
**Project Type**: Web service feature spanning two existing components (Python ingestion
agent + Next.js BFF/backend) — no new service or deployable is introduced
**Performance Goals**: No new latency budget is introduced by the spec; the target is that
recording a fetch adds no user-visible slowdown to ingestion (in line with the existing
best-effort `append_log` callback, which does not block the agent loop on write failure)
**Constraints**: MUST NOT alter the behavior, labeling, or content of any existing evidence
kind (FR-009); MUST NOT require any connector-specific integration work to produce ledger
entries (FR-004, FR-005); MUST retain full fetched content (FR-010) while redacting
sensitive tool-call arguments (FR-011); MUST expose entries through an externally
authenticated interface with retention/access independent of other evidence data (FR-012)
**Scale/Scope**: Same order of magnitude as current ingestion runs — tens of fetches per
run, one run at a time per project (existing `project_lock` serializes ingests); no new
scale target is introduced by this feature

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Worse is Better**: A single shared recording helper that existing `build_*_mcp`
  factories call before returning a tool result is the minimal viable interception point —
  no new framework, no rewrite of the connector abstraction. **Pass.**
- **II. YAGNI**: This plan builds only the ledger (capture, storage, evidence-bundle
  surfacing, external retrieval) — not the companion evaluation harness, not a Source
  Fidelity judge, not golden-dataset tooling. Those are explicitly out of scope per the
  spec and the companion design doc §3. **Pass.**
- **III. Rule of Three**: Three existing connectors (GitHub, Confluence, Webex) already
  duplicate the same "return content to the agent" shape independently (each with its own
  `_ok`/`_err` helpers) — extracting a shared point now is justified, not premature.
  **Pass.**
- **IV. Composition over Inheritance**: The recording point is a plain function/decorator
  each `mcp_*.py` module calls or wraps its tools with, not a change to the `Connector`
  ABC's inheritance shape. **Pass.**
- **V. Specs as Source of Truth**: This plan follows `spec.md` in this same directory.
  **Pass.**
- **VI. CI Gates**: New/changed code in both components must pass `uv run ruff check` +
  `uv run pytest` (Python) and `npm run lint` + Jest (TypeScript) before merge. **Pass**
  (enforced at implementation time, not a design concern).
- **VII. Security by Default**: Tool-call argument redaction (FR-011) and a new
  API-key-gated external endpoint (reusing the existing `tome-api-keys.ts` mechanism rather
  than inventing new auth) both follow this principle directly. **Pass.**

No violations identified. Complexity Tracking table is not needed.

*Post-Phase-1 re-check: see end of this document.*

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/2026-09-28-tome-source-fetch-ledger/
├── plan.md                      # This file
├── research.md                  # Phase 0 output
├── data-model.md                # Phase 1 output
├── quickstart.md                # Phase 1 output
├── contracts/                   # Phase 1 output
│   ├── internal-fetch-ledger-callback.md
│   ├── external-fetch-ledger-api.md
│   └── evidence-bundle-source-fetch-kind.md
├── mongodb-migration.md         # Phase 1 output (Storage ≠ N/A)
├── checklists/requirements.md   # From /speckit.specify
└── tasks.md                     # Phase 2 output (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
ai_platform_engineering/agents/tome/tome_agent/
├── agent/
│   ├── connectors/
│   │   ├── base.py              # + shared fetch-recording helper/decorator (the
│   │   │                          single point every connector's tool calls pass through)
│   │   ├── github.py            # unchanged public shape; build_mcp still delegates
│   │   ├── confluence.py        # to mcp_*.py factories, which now route through base.py
│   │   └── webex.py
│   ├── mcp_github.py            # tool functions call the shared recorder instead of
│   ├── mcp_confluence.py        # each defining independent, unrecorded `_ok`/`_err`
│   ├── mcp_webex.py             # helpers
│   ├── http_client.py           # + append_fetch_ledger_entry(run_id, entry) callback,
│   │                              same pattern as existing append_log
│   └── ingestor.py              # thread run_id into connector/MCP construction so
│                                  ledger entries can be attributed to a run
├── orchestrator/
│   └── contract.py              # + FetchLedgerEntry wire schema (shared by agent + backend)
└── tests/
    └── test_fetch_ledger.py     # new — exercises the shared recording point directly

ui/src/
├── lib/tome/
│   ├── evaluation-store.ts      # + tome_fetch_ledger_entries collection accessors
│   ├── fetch-ledger-store.ts    # new — Mongo persistence for ledger entries
│   └── evidence-bundle.ts       # + include `source_fetch` items when assembling a bundle
├── types/tome-evaluation.ts     # + "source_fetch" added to EvidenceKind, + FetchLedgerEntry type
└── app/api/tome/
    ├── api/internal/            # + new internal route the agent POSTs ledger entries to
    │   └── projects/[id]/runs/[runId]/fetch-ledger/route.ts
    └── fetch-ledger/            # new — external, API-key-authenticated retrieval endpoint
        └── [runId]/route.ts
```

**Structure Decision**: This feature extends two existing components in place — the Python
`tome_agent` package and the Next.js `ui` backend — following the existing
agent-callback-to-backend pattern already used for logs (`append_log`) and pages (the
persist hook). No new top-level directory, service, or deployable is introduced; the shared
recording point lives in `connectors/base.py` per the spec's requirement that no connector
can opt out.

## Database migrations

**Deliverable**: [`mongodb-migration.md`](./mongodb-migration.md) in this feature's spec
directory.

Summary: a new collection (`tome_fetch_ledger_entries`) is required — this is additive
only (new collection + indexes), no changes to any existing collection's schema, and no
backfill (ledger entries only exist going forward, for runs that occur after this feature
ships). See `mongodb-migration.md` for index design, rollback, and environment notes.

## Complexity Tracking

*No Constitution Check violations — table intentionally omitted.*

---

## Post-Phase-1 Constitution Check (re-verification)

Re-checked after completing `research.md` and `data-model.md`: the design still routes
through a single shared helper in `connectors/base.py`, adds one new collection with no
changes to existing schemas or evidence kinds, and reuses the existing API-key auth
mechanism for the new external endpoint rather than introducing a new auth scheme. All
seven gates above still **Pass**; no new violations were introduced during design.
