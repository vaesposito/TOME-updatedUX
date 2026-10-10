# Phase 0 Research: Source-Fetch Provenance Ledger

## R1: Where does "the connector tool-call boundary" actually live today?

**Decision**: The shared recording point is a helper function (e.g. `record_fetch(...)`)
added to `connectors/base.py`, which each `mcp_*.py` module's tool functions call in place
of their current per-module `_ok()` helper before returning a result to the agent.

**Rationale**: `Connector.build_mcp()` (defined per-connector in `connectors/github.py`,
`confluence.py`, `webex.py`) does not itself perform any HTTP fetch — it just returns the
result of `build_github_mcp()` / the Confluence and Webex equivalents, each of which is an
independently-defined in-process MCP server (`create_sdk_mcp_server` + `@tool`-decorated
functions) in `mcp_github.py`, `mcp_confluence.py`, `mcp_webex.py`. Each of those modules
currently defines its own `_ok(payload)` / `_err(message)` helpers with no shared code path.
So "centrally in `connectors/base.py`" cannot mean "in the `Connector` class's own method
bodies" (there's no fetch happening there); it means base.py becomes the single place that
*defines* the recording helper, which all three tool-implementation modules import and call
— matching the spec's requirement (FR-004) that omission requires an affirmative choice not
to call the shared helper, not merely "forgetting" to add ledger code, since the normal
`_ok()` call site is being replaced, not supplemented.

**Alternatives considered**:
- *Wrap at `Connector.build_mcp()` return value* — rejected: by the time `build_mcp()`
  returns, the MCP server object already has its tool functions closed over; wrapping the
  returned object can't intercept individual tool calls without significant SDK-level
  interception machinery, which is more complex than editing three call sites.
  Also `Connector.build_mcp()` returns SDK server, not the tool implementations. Rejected as
  more complex for no benefit.
- *Wrap at the `@tool` decorator itself* — considered viable as an alternative
  implementation of the same idea (a decorator in `base.py` applied to each tool function),
  but the existing modules build tools with a factory pattern (`build_github_mcp(repos,
  token)` closes over `allowed`/`token`), and the actual response payload naturally already
  flows through `_ok()`/`_err()` at each call site — replacing that shared helper is a
  smaller, more localized change than re-architecting the tool-registration flow into a
  decorator-first shape. Documented here as the fallback if a decorator proves cleaner at
  implementation time; either satisfies FR-004/FR-005 equally.

## R2: How does content reach the agent, and what exactly should be hashed?

**Decision**: Hash and store the exact string(s) placed into the `content` text block of
the MCP tool result (i.e., the same value passed to `json.dumps(...)` in today's `_ok()`),
after any truncation the tool itself applies — not the underlying source item as a whole.

**Rationale**: `mcp_github.py`'s `github_get_file` truncates to the first 16,000 characters,
and `github_get_file_chunk` returns a bounded slice; `_ok()` wraps whatever payload it's
given as `{"content": [{"type": "text", "text": json.dumps(payload)}]}`. The spec (FR-002)
is explicit that the hash must cover "the exact bytes returned to the agent," which for a
truncated or paginated tool means the truncated/paginated slice, not the full file. This
also directly determines what "full fetched content" (FR-010) means for storage: the same
already-truncated/paginated string, not a second independent fetch of the untruncated
source.

**Alternatives considered**: Hashing the pre-serialization payload object instead of the
final JSON text was considered, but rejected — it would require re-implementing the same
JSON encoding at verification time to reproduce the hash, whereas hashing the exact
outgoing text is verifiable byte-for-byte without touching connector internals.

## R3: How does the agent get ledger data to persistent storage?

**Decision**: Follow the existing `append_log(run_id, line)` pattern in `http_client.py`
exactly: a new `append_fetch_ledger_entry(run_id, entry)` function POSTs to a new internal
route (`/api/internal/projects/{project_id}/runs/{run_id}/fetch-ledger`), mirroring
`POST /api/internal/projects/{id}/runs/{run_id}/log` (contract.py's documented "agent →
backend callbacks"). Failure to persist an entry is logged as a warning and does not fail
or interrupt the ingestion run — the same resilience posture `append_log` already has.

**Rationale**: The agent container has no direct MongoDB access by design (`workspace.py`:
"The backend (Mongo) is the source of truth"; `http_client.py`'s own module docstring says
the agent talks to `ttt-backend/internal/...` "instead of writing sqlite directly").
Reusing this exact pattern needs no new agent-side infrastructure (auth, retries, base URL
resolution are already solved by `http_client.py`), and matches CLAUDE.md's "reuse before
adding new" guidance.

**Alternatives considered**: Buffering all of a run's ledger entries in the agent and
POSTing them as one batch at the end of ingestion was considered (fewer HTTP calls), but
rejected for this feature: it would mean a mid-run crash loses every ledger entry for that
run, undermining the "regardless of whether the LLM ends up citing... ignoring" completeness
guarantee (FR-001, FR-003) for exactly the runs where something went wrong — which is when
the ledger is most valuable. Per-fetch POSTs (same cost model as `append_log`, which already
does this per log line) preserve entries even if the run later fails.

## R4: How does this integrate with the existing evidence-bundle mechanism (FR-008)?

**Decision**: `captureEvidenceBundle` (`ui/src/lib/tome/evidence-bundle.ts`) gains a new
step that loads the target run's `tome_fetch_ledger_entries` documents and maps each to an
`EvidenceItem` with `kind: "source_fetch"`, alongside its existing steps for pages,
templates, and project snapshot. This requires `captureEvidenceBundle`'s caller to supply a
`run_id` to scope which run's ledger to include (today the bundle is built from the current
page-store snapshot, which has no run concept — this is a new parameter, not a change to
existing behavior for callers that don't supply one).

**Rationale**: Per the companion eval design (§2.2), the existing `EvidenceKind` union
(`github | confluence | webex | myagent | wiki | template | seed | project_snapshot`) is
assigned purely by page-store path prefix — none of it is a raw fetch. Adding `source_fetch`
alongside these, without touching `pageEvidenceKind()` or any existing item's classification,
satisfies FR-009 (no existing kind's behavior changes) by construction: it's a new code path
appending new items, not a modification of the existing mapping function.

**Alternatives considered**: Making `source_fetch` items appear automatically in *every*
evidence bundle regardless of run was rejected — a bundle is captured at experiment-launch
time from current page-store state and has no inherent "run" until one is specified; forcing
a default run (e.g. "most recent ingest") would silently couple bundle capture to ingestion
history in a way today's bundle capture does not depend on, and would make bundles for
non-ingestion operations (e.g. `synthesize`, `compact`) ambiguous about which run's fetches
to include.

## R5: How should the external-facing retrieval interface (FR-012) authenticate?

**Decision**: Reuse the existing Tome API-key mechanism (`ui/src/lib/tome-api-keys.ts`,
already used to authenticate the external Connector Studio REST surface at
`ui/src/app/api/tome/connector/`) for the new fetch-ledger retrieval endpoint, rather than
introducing a second auth scheme.

**Rationale**: CLAUDE.md's reuse table calls out "Slack or Webex behavior... The BFF/API
contract and shared auth utilities" and the general "reuse before adding new" principle;
`tome-api-keys.ts` already provides scoped, owner-bound API keys with an existing
verification path (`verifyTomeApiKey`). Introducing a separate token scheme for this one
endpoint would add a second thing to audit and rotate for no behavioral benefit.

**Alternatives considered**: A dedicated service-to-service credential (e.g. a static shared
secret for the companion evaluation system specifically) was considered, given FR-012 calls
for retention/access "independent of other evidence data." Rejected for v1: independence of
*retention policy* does not require independence of *authentication mechanism* — the same
API-key infrastructure can scope a key to read-only fetch-ledger access without a new auth
system. Revisit only if the companion system needs machine-to-machine auth patterns
(e.g. mTLS) that user-owned API keys can't express.

## R6: Redaction of tool-call arguments (FR-011)

**Decision**: Apply a per-connector allowlist of argument fields safe to log verbatim
(e.g. `repo`, `number`, `page_id`, `room_id` — identifiers, not free text), and redact any
argument not on that allowlist (e.g. `query` in `github_search_issues`, any Confluence CQL
filter argument) to a fixed placeholder plus its length, consistent with how Tome already
treats Gists as excluded-by-default sensitive content.

**Rationale**: The spec's concern (FR-011) is specifically free-text arguments that could
themselves carry sensitive terms, not identifiers like a repo slug or issue number, which
already appear unredacted in the canonical URI itself (FR-001) and provide no additional
exposure. An allowlist-by-field-name approach is simple to apply per connector and doesn't
require content-sniffing/classification logic.

**Alternatives considered**: A generic PII/secret scanner over all arguments was considered
and rejected as disproportionate — it would add a new dependency and false-positive/negative
surface for a problem (a handful of known free-text argument fields across three connectors)
that's fully enumerable today.
