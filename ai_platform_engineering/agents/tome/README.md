# Tome Agent

The LLM "brain" for the **Tome** wiki app (the UI shell lives in `ui/src` under
`lib/tome`, `components/tome`, `app/api/tome`). caipe-ui is LLM-free by design,
so all model work is delegated to this Python service over HTTP/SSE — the same
pattern the platform uses for the supervisor and dynamic agents.

It runs the **Claude Agent SDK** ingest + chat loops. The UI proxies
`POST /chat`, `POST /ingest`, `POST /presentation`, and `POST /evaluate` to it; the agent calls back to the UI's
`/api/tome/api/internal/...` endpoints for the project snapshot, page bodies,
and persistence. CAIPE Mongo is the system of record.

Every agent-operation endpoint requires `Authorization: Bearer <token>`.
The UI's `TOME_AGENT_TOKEN` must match this service's `TTT_AGENT_TOKEN`; the
same bearer is used for agent-to-UI callbacks. Only `/healthz`, `/readyz`, and
the passive `/metrics` scrape endpoint are unauthenticated.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/chat` | Chat turn → `text/event-stream` (`token`/`tool_call`/`tool_result`/`session`/`done`/`error`) |
| POST | `/ingest` | Ingest run → `text/event-stream` (`log`/`tool_call`/`page_written`/`done`/`error`) |
| POST | `/evaluate` | Blinded, structured claim and fidelity evaluation against frozen evidence |
| POST | `/evaluate/chat` | Claim and relevance/completeness evaluation for a chat transcript's final answer against frozen evidence |
| POST | `/presentation` | Toolless generation or revision of a structured, source-grounded slide deck |
| POST | `/presentation/stream` | SSE stream of deck generation followed by the validated editable deck |
| POST | `/presentation/requirements/stream` | SSE stream of AI Assist output followed by a validated editable brief |
| POST | `/model-check` | Toolless smoke test for an administrator-selected model id |
| GET | `/healthz` · `/readyz` · `/metrics` | Liveness / readiness / metrics |

## Configuration (env)

### Ingest startup and completion

- Full system prompts, including prefetched meeting transcripts, use the SDK's
  system-prompt file support instead of a command-line argument. No transcript
  truncation is applied. The private temporary file is removed after the session.
- Startup errors, failed SDK results, and streams without a successful completion
  mark the run **failed**, not succeeded or awaiting review. Failed ingest passes
  stop before subsequent passes and template-binding reconciliation.
- This affects new runs only; previously recorded outcomes are not rewritten or
  automatically retried.

### Environment variables

| Var | Meaning |
|---|---|
| `TTT_PROJECT_ID` | CAIPE project id/slug (opaque; used to build callback URLs) |
| `TTT_BACKEND_URL` | Base for the UI's tome API, e.g. `http://caipe-ui:3000/api/tome` |
| `TTT_AGENT_TOKEN` | Required shared bearer for UI → agent operations and agent → UI callbacks (non-empty) |
| `TTT_PROJECT_ROOT` | Working-copy dir for the agent's file tools (rehydrated each run) |
| `TTT_AGENT_ROLE` | `editor` \| `viewer` |
| `TTT_CHAT_MODEL` / `TTT_INGEST_MODEL` / `TTT_PRESENTATION_MODEL` | Deployment fallback model ids when no exact/type/global setting exists |
| `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` | Anthropic-style endpoint + key (a proxy may front Bedrock etc.) |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | Langfuse project credentials; tracing is enabled when both are present |
| `LANGFUSE_BASE_URL` | Langfuse server URL, e.g. `https://langfuse.example.com` |
| `LANGFUSE_TRACING_ENABLED` | Optional kill switch; defaults to `true` when Langfuse credentials are configured |
| `GITHUB_TOKEN` / `CONFLUENCE_TOKEN` / `WEBEX_TOKEN` | Read-only source tokens for the connector MCPs (optional) |

Webex request credentials may include `messaging_only: true`. In that mode the
embedded Webex MCP registers only room, message, and people tools; meeting,
recording, transcript, and summary tools are unavailable.

Mixed personal/managed space ingestion supplies `credentials.webex.room_tokens`
as a JSON map of attached room IDs to tokens. Each room uses only its mapped
token; missing or malformed mappings never fall back to another account.
Message/person detail lookups with mapped credentials require IDs previously
seen in that room's messages. Meeting tools use only `webex.access_token`
(the caller's own credential), never a generic room token. The UI does not
forward room-token mappings to chat. No ambient service credential is created.

The endpoint, models, and credentials are config-driven — nothing host- or
product-specific is hardcoded. Model resolution is exact entity, entity type,
global, environment, then built-in fallback. `TTT_CHAT_MODEL` backs chat and
is also the presentation fallback when `TTT_PRESENTATION_MODEL` is unset;
`TTT_INGEST_MODEL` backs ingest, synthesis, and compaction;
`TTT_PRESENTATION_MODEL` backs PowerPoint generation and revision.

### Langfuse tracing

Tome uses the Claude Agent SDK, and the optional OpenInference Claude Agent SDK
instrumentation captures each agent run, Claude generation, and SDK tool call.
It is initialized before the FastAPI service accepts requests, so all existing
SDK entry points are covered without changing their prompts or tool policies.
Tracing is fail-open: missing credentials or an initialization error is logged
and does not prevent Tome from serving requests.

For a self-hosted Langfuse deployment, set `LANGFUSE_BASE_URL` to the server
URL and inject project credentials through the deployment secret. Do not put
the keys in the image, repository, or a checked-in `.env` file. For short-lived
processes, call `langfuse.flush()` after the final agent run; the HTTP service
flushes queued spans during graceful shutdown.

## Experiment isolation

Experiment requests carry an experiment id, artifact id, candidate model, seed, turn limit, and a
frozen evidence bundle. The agent reconstructs the workspace from that bundle and disables live
connector, web, feed, and TOME MCP tools. Page-write callbacks include both ids; the UI routes them to
the experiment artifact collection instead of the live page store. The evaluator receives a blind
label and evidence hashes, never the candidate model identity.

## Confluence body chunking

- `confluence_get_page_content(page_id)` returns the first storage XHTML chunk
  with source version/time, `content_revision`, `total_chars`, and `next_offset`.
- Each body response is capped at **8,000 serialized UTF-8 bytes**, including
  metadata and JSON escaping. A chunk contains at most 6,000 characters; Unicode
  or escape-heavy content can produce smaller chunks.
- Continue with `confluence_get_page_content_chunk(page_id, offset,
  content_revision, limit)`, using the previous `next_offset` and a limit of
  1–6,000, until `next_offset` is null. Concatenating bodies reconstructs the
  original storage content, including long lines, links, and table cells.
- Continuations recheck source authorization and the body/metadata revision.
  If the source changes, restart the read; different revisions cannot be mixed.
- Tree results remain excerpts. Ingest and chat instructions require complete
  reads for mutable tracker claims and disclosure when a page is only partially
  read. No shell or out-of-workspace result-file access is needed.
- Each chunk is recorded through the existing fetch ledger. Chunking bounds an
  individual response; reading a large page still consumes multiple tool calls
  and model context. Ingestion checks coverage before accepting a successful
  agent result: every selected root and every attempted body read must cover
  the complete revision from offset zero without gaps. Missing credentials,
  discovery errors, truncated trees and unfinished reads emit an error and
  stop later synthesis/reconciliation. Retry a failed read from its first chunk.
- This completion check reports partial ingestion; it does not roll back page
  writes already made during the run. Tree/list excerpts do not establish full
  body coverage. Chat retains the bounded tools and disclosure instructions;
  the terminal success gate applies to ingestion.

## Source-fetch provenance ledger

Every GitHub/Confluence/Webex tool call the ingestion (and compaction/
synthesis) agent makes is recorded to a per-run **fetch ledger** — the exact
bytes returned to the agent, hashed, plus a canonical URI, timestamp, and
(redacted) tool name/args — regardless of whether the agent goes on to cite,
summarize, or ignore that content. This is independent of the LLM's own
citation behavior: the existing `github`/`confluence`/`webex` evidence-bundle
kinds are LLM-authored wiki pages, not raw fetches (see
`docs/docs/evaluations/tome_external_eval_design.md` §2.2).

- **Recording**: enforced once, centrally, in `connectors/base.py`'s
  `record_fetch()` — every `mcp_github.py`/`mcp_confluence.py`/`mcp_webex.py`
  tool function is decorated with it in place of its own `_ok()`/`_err()`
  return path, so no connector can omit or bypass it. Recording is
  best-effort and never fails or slows the agent loop; a chat turn (no active
  run id) records nothing.
- **Redaction**: tool-call arguments are redacted to a length-preserving
  placeholder unless they're on that connector's identifier allowlist (repo
  slugs, page ids, room ids, numbers) — a free-text argument like a GitHub
  search query never reaches the ledger. Fetched *content* is retained in
  full; redacting it would defeat the ledger's purpose.
- **Storage & retrieval**: persisted via the same agent → backend callback
  pattern as `append_log` (`POST /api/internal/projects/{id}/runs/{run_id}/
  fetch-ledger`), stored in MongoDB (`tome_fetch_ledger_entries` +
  `tome_fetch_ledger_run_summaries`, TTL-retained per
  `TOME_FETCH_LEDGER_RETENTION_DAYS`), surfaced as a new `source_fetch`
  evidence-bundle kind (opt-in via `captureEvidenceBundle({ runId })`), and
  retrievable externally via `GET /api/tome/fetch-ledger/{run_id}`
  (Tome-API-key authenticated) for systems outside Tome, such as the
  companion evaluation design's Source Fidelity check.

See `docs/docs/specs/2026-09-28-tome-source-fetch-ledger/` for the full spec,
plan, and design rationale.

## Run (local dev)

```bash
TTT_AGENT_TOKEN="$(openssl rand -hex 32)" \\
uv run uvicorn tome_agent.agent.main:app --host 127.0.0.1 --port 8766
```

Point the UI at it with `TOME_AGENT_URL` (e.g. `http://127.0.0.1:8766`) and
set its `TOME_AGENT_TOKEN` to the same value.
