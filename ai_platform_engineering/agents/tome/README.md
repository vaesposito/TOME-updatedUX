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

## SharePoint document preparation

Manual and scheduled ingestion of selected folders' direct **PPTX and PDF** documents, using
the deployment's app-only SharePoint MCP. No personal Microsoft connection is
required. Folders are explicitly attached, never a whole-site crawl.

- Enable a `provider: source`, `source: sharepoint` onboarding step to expose
  the picker in project creation and **Settings → Sources**.
- **Settings → Sources** and project creation attach folders only. Browse libraries,
  search folders, and choose which direct PDF/PPTX files to attach. The saved folder
  stores `selected_item_ids` for the initial batch and a server-validated
  `excluded_item_ids` list for existing files left unchecked. Later additions remain eligible.
  Empty folders (no supported direct files) can be attached with an empty initial
  selection. They ingest nothing until PDF/PPTX files are added directly to them;
  subsequent manual and scheduled runs discover those files under the same limits.
  A folder never includes nested folders; attach a child folder separately if needed.
  Up to ten source references can be saved. **Choose files** reopens a saved folder
  for an explicit selection edit; changes apply only when **Save file selection**
  is pressed. An explicit save captures current unchecked files as excluded.
  Existing individual files and legacy direct-all/fixed-selection folders are not
  automatically rewritten. For a previously saved fixed selection, **Choose files →
  Save file selection**, then save project sources, enables later additions.
- Each manual/scheduled run freshly lists direct children. Initially selected files
  and files added after the selection are eligible; existing unchecked IDs stay excluded,
  even if those files change. A folder with 500 files can be browsed and attached with
  up to ten initial files. Current Graph tags are compared against persisted, live
  dedicated summary pages before applying the batch limit. Unchanged successfully
  ingested versions and user-protected pages do not consume the batch allowance.
  Overlapping references are deduplicated by drive/item ID. At most ten unique
  new/changed PDF/PPTX documents across sources/context are ingested in one run;
  the aggregate size for folder runs is bounded by the MCP's configured
  `SHAREPOINT_MAX_DOCUMENT_BYTES` (2 GiB by default). Larger selections fail explicitly
  before agent document ingestion with an explicit instruction to choose files in
  Sources; there is no arbitrary ordering, silent partial batch, or automatic retry.
  Folder previews scan at most 1000 direct entries, paginate fully within
  that bound, and exclude unsupported types/remote shortcuts. New folder selections
  require at least one file. Whole libraries cannot be attached. Removed, moved or
  unsupported selected files fail explicitly; no replacement is picked automatically.
- **Run ingest → Full ingest** includes the selected documents alongside other
  attached sources. The preview shows their application execution identity.
- Each included document gets a dedicated summary page under the **SharePoint**
  wiki folder, marked with the SharePoint logo. This also applies to documents
  whose topic does not match the project's charter: attaching the source keeps
  the document; only relevant evidence is merged into the project's main pages.
- Document pages cite the original file and source pages/slides. Paths use a
  stable drive/item identity (`sharepoint/doc-<identity>.md`); titles use the
  filename. Renames, version changes, and repeat ingests reuse that same path;
  different files with the same name remain separate. These are document
  summaries, not binary copies or full transcripts of the original files.
- A successful document pass must have saved every new/changed document page.
  A memory-only update or a local file whose persistence failed is an explicit
  ingest error, with no automatic retry/recovery. Unchanged versions can keep
  their existing page; user-pinned stable/hidden pages are preserved and reported.
- **Run ingest → Add context: SharePoint documents** adds one-off PPTX/PDF files
  to this run alongside saved sources (also available during Area/BHAG synthesis).
  These references are stored on the run, never on the project's sources or
  auto-ingest configuration. Cascade runs keep this context on the parent only.
  Folder additions, saved legacy files, and one-off files are deduplicated by drive/item ID,
  with ten new/changed files total for folder-backed runs.
  Submit rechecks current app access; file preparation happens in the agent.
  Quick edits, compaction and meeting-only runs do not include this context.
- For a single file, use the one-off context picker rather than Settings. SharePoint
  site pages are a separate content type and are not supported by this connector yet.
- **Settings → Auto-ingest** uses the existing cadence, queue, history and
  review settings. The confirmed schedule owner remains the run's actor, but
  SharePoint access uses the static application rather than that owner's OAuth.
- Each run checks current metadata. Unchanged versions reuse prepared artifacts.
  Files whose dedicated persisted summary already matches the current source version
  skip the document model pass; new/changed versions are processed. A prepared cache
  alone is not proof of ingestion: a missing/failed summary still needs processing.
  User-protected pages remain unchanged. This is not a change-only Graph poller:
  scheduled runs still execute the existing ingest/review workflow.
- Deleted/inaccessible files fail with an administrator-facing explanation;
  no sources, failed runs, or existing records are automatically repaired.
- Recurring Webex meeting-only runs never include SharePoint documents.
- Areas/BHAGs use the same restricted document pass before synthesizing their
  own wiki with child projects; documents cannot read the child wikis directly.
- Site pages, DOCX/XLSX, `.ppt`, embedded video/audio and animations are not
  supported by this file-ingestion surface.

1. Select stable drive/item IDs from the configured SharePoint MCP.
2. TOME streams each selected file through the MCP's authenticated `/documents`
   routes. Graph credentials and signed URLs stay inside the MCP.
3. PowerPoints become a rendered PDF plus ordered slide text and speaker notes.
   PDFs retain visual pages and extracted per-page text. Scanned pages remain
   usable visual evidence, with an explicit no-text warning.
4. The processor produces PDF batches (default eight pages, at most 20 MiB per
   batch) and source/page mappings. It never puts a 1 GB deck into a prompt.
5. The existing Claude Agent SDK `Read` tool reads the staged PDFs/text in a
   separate scoped ingest pass. The agent receives source URL/slide citations;
   it has no SharePoint credentials, Bash, general web, or other-project tools
   in that pass. Existing wiki write/stable-page protections remain active.

### Agent request

Add this to an authenticated `/ingest` request alongside its normal snapshot,
run/report IDs and options:

```json
{
  "connector_data": {
    "sharepoint": {
      "documents": [{"drive_id": "example-drive", "item_id": "example-item"}]
    }
  }
}
```

- Up to ten selected documents; duplicates are prepared once. Files are never
  downloaded implicitly from unrelated ingest runs or frozen experiments.
- Preparation finishes before any wiki writes. A failed conversion, changed
  version, missing access, or resource limit produces an error, not silent
  text-only ingestion or a partial document cache.
- Repeated runs reuse unchanged versions in
  `/project/.source-cache/<project-id>/<version-hash>/`. This is outside the wiki
  directory so wiki rehydration cannot remove it. New versions create new
  directories; there is no automatic eviction, repair, persisted-run retry,
  migration, or backfill. Existing cached versions/runs are not rewritten.
- Raw downloads and Office profiles are deleted after preparing; only bounded
  model-readable artifacts, source metadata, and a manifest are retained.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `TOME_SHAREPOINT_API_URL` | unset | MCP HTTP origin/base path, **without** `/mcp` (for example `http://mcp-sharepoint:8000`) |
| `TOME_SHAREPOINT_API_TOKEN` | unset | Bearer accepted by the MCP's `shared_key`/`oauth2` authentication; inject through existing secrets |
| `TOME_DOCUMENT_RENDERER` | `graph_then_local` | `graph`, `local`, or Graph conversion with offline fallback for conversion/server/network failures; never bypasses HTTP 403/404 |
| `TOME_DOCUMENT_MAX_BYTES` | `2147483648` | Original file ceiling (2 GiB) |
| `TOME_DOCUMENT_MAX_PDF_BYTES` | `268435456` | Rendered/source PDF ceiling (256 MiB) |
| `TOME_DOCUMENT_DOWNLOAD_TIMEOUT_SECONDS` | `600` | Whole preparation deadline, including downloads/processing |
| `TOME_DOCUMENT_PROCESS_TIMEOUT_SECONDS` | `180` | Deadline for each renderer/processor subprocess |
| `TOME_DOCUMENT_PROCESS_MEMORY_MIB` | `384` | Processor address-space ceiling; renderer heap/anonymous-allocation ceiling (shared-library mappings have a separate 2 GiB minimum address-space ceiling) |
| `TOME_DOCUMENT_BATCH_PAGES` | `8` | Pages per SDK-readable PDF batch, 1–20 |
| `TOME_DOCUMENT_SDK_MAX_BUFFER_MIB` | `64` | Per-message SDK JSON buffer for the document pass only, 32–64 MiB; accommodates encoded visual Read results without changing file/batch/model limits |
| `TOME_DOCUMENT_MAX_PAGES` | `1000` | Slide/page ceiling, up to 2000 |

Documents are streamed to disk and read in bounded PDF batches (at most 20 MiB
each), not stored as binary MongoDB records. The SDK buffer is a separate limit
on one serialized CLI message: base64 visual data can exceed its 1 MiB default
even for a small batch. The document pass uses a capped 64 MiB buffer; normal
source/chat passes keep the SDK default. This is not a total session-memory
limit or an increase to model context. Excessive messages still fail with a
content-safe buffer-limit error rather than exposing source evidence in logs.
There is no automatic retry or rewriting of existing cached documents/runs.

Local rendering is included in the TOME image. It runs a fixed command with no
application credentials, high macro security, no external linked content, and
no embedded audio/video in its rendering copy. Linux Landlock restricts file
reads to runtime/font files and this run's staging directory; writes are limited
to staging plus creation of a profile-hashed Unix IPC socket in `/tmp`. Trusted
cleanup removes only that new profile's socket. Seccomp blocks non-Unix network
sockets. Unsupported kernels/architectures fail closed; the current helper
supports Landlock-enabled Linux x86-64/aarch64. Container memory limits still
cap resident memory; one preparation runs at a time per TOME process.

Limits also cover ZIP/XML expansion, extracted text, output artifacts, disk
reserve, and download size. Hidden-slide text/notes are retained if the renderer
omits their visual pages; mismatched page counts fail rather than attributing
content to the wrong slide. Layout/font fidelity can differ in LibreOffice;
animations, linked content, audio, and video are explicitly **not** ingested.
Very large image-heavy decks can still exceed limits. No OCR service or
audio/video transcription was added.

The live probe included a 1.1 GB video-heavy presentation and a 50 MB deck.
Embedded recordings need not make a deck expensive to render, but a 12 MB
image-heavy sample needed a 2048 MiB processor allocation limit and a 3 GiB
container limit. File size alone is not a safe memory estimate. Match processor
limits to container headroom; the 384 MiB code default is intentionally
conservative. These probes validate preparation and cache reuse, not an LLM's
semantic understanding or a UI-to-wiki run.

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


### Global Ask Tome

- The same service runs project operations as SDK runs and global retrieval as
  direct Messages function calls. Global turns use neither MCP nor Claude Code.
- `ChatRequest.global_chat` selects read-only retrieval. The BFF provides an
  access-filtered BHAG/area/project catalog and the authenticated actor subject.
- Each turn streams published page heads from the canonical PageStore into a
  private temporary view. Drafts, rejected revisions and tombstones are excluded.
  The ingestion mirror and its credentials are never opened by this runtime.
- Files live at `entities/<hashed-entity-id>/pages/<published-path>`. Navigation
  indexes express relationships without duplicating a project's wiki. Root mode
  is 0700; staged files are 0400. The view is removed on success, error or ordinary
  cancellation. A forced process termination can leave files in container `/tmp`.
- Initial context includes navigation/overview excerpts and complete documents:
  the entire corpus when it fits, otherwise broad charters, question-relevant
  pages and core progress/decision/memory pages within a 128,000-character budget.
- Native functions are `list_projects`, `list_project_pages`, `glob_pages`,
  `search_pages` and `read_project_page`. Search supports ranked keyword excerpts
  or literal ripgrep; it is not semantic/vector search. Globs use relative POSIX
  `*`, `?` and whole-segment `**`. Reads support offsets and line ranges.
- Permission checks run before/after search and reads, before/after model calls,
  and at snapshot completion. A changed catalog aborts the turn; the next turn
  discards private model history. No partial snapshot is used for reasoning.
- Source references contain citation, revision id/time, content hash and capture
  time. Page capture times span a reported window; the corpus is not an atomic
  database snapshot or live verification of upstream systems.
- Limits: 64 MiB corpus, 2 MiB/page, 20,000 pages; 75 seconds to prepare, 270 seconds
  per turn; 12 model calls, 32 function calls, 120,000 additional evidence
  characters; 48,000 characters/read. Search returns pagination and coverage;
  literal search caps at three matching lines/page, 1,000 matches, 8 MiB output
  and eight seconds. Oversized/incomplete snapshots fail closed.
- GRID owns visible history. Mongo stores eight bounded user/assistant messages
  per user/conversation, TTL seven days. Raw pages and function results are not
  persisted in model history. The global model setting applies.
- The five functions are the model capability boundary. There is no arbitrary
  filesystem, shell, write, credential or model-selected network capability.
  Private views are not separate OS sandboxes; adding code execution would
  require stronger isolation. Project ingestion/chat still use their existing SDK
  and connector MCPs.
