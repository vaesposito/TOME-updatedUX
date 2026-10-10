# Feature Specification: Source-Fetch Provenance Ledger

**Feature Branch**: `2026-09-28-tome-source-fetch-ledger`
**Created**: 2026-09-28
**Status**: Draft
**Input**: User description: "no artifact in Tome today records what raw source content the ingestion agent actually fetched, independent of the LLM's own citation behavior. This is worth fixing in Tome itself... wrap the connector tool-call boundary once, centrally in `connectors/base.py` (not per-connector, so no connector can opt out or forget it), so every GitHub/Confluence/Webex fetch the ingestion agent makes mechanically records `{canonical_uri, content_hash (sha256 of the exact bytes returned to the agent), timestamp, tool name/args}` to a per-run ledger — regardless of whether the LLM ends up citing, summarizing, or ignoring that content. Surfaced as a new, honestly-labeled evidence-bundle kind (e.g. `source_fetch`), kept distinct from the existing `github|confluence|webex` kinds which are actually LLM-written pages, not raw fetches."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Verify a generated claim against what was actually fetched (Priority: P1)

An engineer, SME, or an external evaluation system is reviewing a Tome-generated wiki page
or chat answer and needs to check whether a specific claim about a GitHub issue,
Confluence page, or Webex conversation is faithful to the real source — not just
internally consistent with Tome's own prior output. Today there is no record of what raw
content the ingestion agent actually pulled from the source system during a run, so this
check is impossible without re-fetching the source by hand and hoping nothing has
changed since ingestion.

**Why this priority**: This is the core problem statement — without it, no other part of
this feature has a reason to exist. It is also what unblocks the "Source Fidelity"
evaluation dimension described in the companion Tome evaluation design
(`docs/docs/evaluations/tome_external_eval_design.md` §2.2, §6.1), which today has no way
to check generated claims against real source content.

**Independent Test**: Run an ingestion against a project with GitHub, Confluence, and
Webex sources enabled, capturing every raw tool response independently (e.g. via request
recording). Retrieve that run's fetch ledger and confirm every logged entry's content hash
matches the sha256 of the corresponding independently-captured raw response, and that the
ledger's canonical URI and timestamp correctly identify which fetch produced it.

**Acceptance Scenarios**:

1. **Given** an ingestion run that fetches a GitHub issue, a Confluence page, and a Webex
   room's messages, **When** the run completes, **Then** the fetch ledger for that run
   contains one entry per fetch, each with a canonical URI identifying the exact source
   item, a content hash, a timestamp, and the tool name and arguments used.
2. **Given** a fetch whose content the ingestion agent never cites, summarizes, or
   otherwise references in any generated page or answer, **When** the run completes,
   **Then** that fetch still appears in the ledger exactly as any cited fetch would.
3. **Given** a completed run's ledger entry for a specific fetch, **When** the same
   content is independently re-fetched from the live source at the same point in time,
   **Then** its hash matches the ledger's recorded content hash.

---

### User Story 2 - New or modified connectors cannot silently skip the ledger (Priority: P2)

Whoever maintains Tome's connectors (GitHub, Confluence, Webex, and any added later) needs
confidence that ledger entries are produced automatically for every source fetch, without
depending on each connector's author remembering to add logging. A ledger that can be
silently bypassed by a new or modified connector — even accidentally — would undermine the
core guarantee in User Story 1: that "no ledger entry" reliably means "no fetch happened,"
not "someone forgot to wire up logging."

**Why this priority**: This is what makes the ledger trustworthy as a completeness
guarantee rather than a best-effort log. It is a precondition for User Story 1 to hold
over time, but the system already delivers value for existing connectors even before a
new connector is added, so it is ranked below the core capability.

**Independent Test**: Point a connector's fetch calls at a stub/mocked source, or add a
minimal test connector, without writing any connector-specific ledger code. Confirm ledger
entries still appear for its fetches, proving the guarantee is enforced at a shared
boundary rather than by convention.

**Acceptance Scenarios**:

1. **Given** an existing connector (GitHub, Confluence, or Webex) makes a source fetch,
   **When** that fetch completes, **Then** a ledger entry is recorded without any
   connector-specific ledger-writing code having been added to that connector.
2. **Given** a new connector is added for a source type not yet supported, **When** it
   makes a fetch through the same shared tool-call boundary, **Then** its fetches are
   logged to the ledger with no additional integration work beyond implementing the
   connector itself.

---

### User Story 3 - Consume fetch records without confusing them for generated pages (Priority: P3)

Someone consuming Tome's evidence bundle — whether Tome's own grounding evaluator in the
future, or the external evaluation system described in the companion design doc — needs to
tell raw fetch records apart from the existing `github`/`confluence`/`webex` evidence-bundle
entries, which are actually LLM-authored summary pages, not source mirrors. Conflating the
two would recreate the exact mislabeling problem this feature exists to fix.

**Why this priority**: This is about safe, unambiguous consumption of the data captured in
User Stories 1–2, not about capturing it in the first place. It matters, but a ledger that
exists and is merely inconvenient to distinguish still has value; one that is silently
mislabeled does real harm, which is why it isn't P1 (the harm only materializes once
someone starts consuming the data).

**Independent Test**: Request the evidence bundle for a completed run and confirm raw fetch
records appear as their own distinct kind, with none of the existing
`github`/`confluence`/`webex` page entries reclassified, removed, or altered.

**Acceptance Scenarios**:

1. **Given** a completed ingestion run that both fetched source content and generated
   wiki pages from it, **When** the evidence bundle for that run is produced, **Then** the
   raw fetch records appear under a distinct evidence kind separate from the
   `github`/`confluence`/`webex` page kinds.
2. **Given** the new evidence kind exists, **When** any existing consumer of the
   evidence bundle (e.g. the current grounding evaluator) processes it, **Then** the
   existing `github`/`confluence`/`webex`/`wiki`/`template`/`seed`/`project_snapshot`
   kinds behave exactly as they did before this feature, unaffected by the addition.

---

### Edge Cases

- **Failed or errored fetch**: A tool call to a source system fails (timeout, rate limit,
  404, permission error). The ledger records that the fetch was attempted (tool name,
  args, timestamp, canonical URI where determinable) and marks it as failed, with no
  content hash — since no bytes were returned to the agent, there is nothing to hash. This
  preserves the "no ledger entry means no attempt" guarantee from User Story 2.
- **Repeated or overlapping fetches in one run**: The same content is fetched more than
  once in a run (e.g. a broad listing followed by a targeted re-fetch of one item, or the
  agent calling the same tool twice). Each tool call is logged as its own entry; the
  ledger is a call log, not a deduplicated content store, so repeated identical hashes
  across entries are expected and not an error.
- **Truncated or paginated responses**: Some tools return only part of a source item (for
  example, a file-read tool that caps output length, or a paginated listing). The content
  hash is computed over exactly the bytes returned to the agent for that call, not the
  full underlying source item — so a truncated read and a full read of the same source
  item legitimately produce different hashes and are recorded as separate entries.
- **Unchanged content fetched across separate runs**: The ledger is scoped per run; two
  ingestion runs that each fetch the same unchanged source item produce two separate
  ledger entries (in two separate runs' ledgers), not a single deduplicated record.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST record one ledger entry for every source-system fetch
  (GitHub, Confluence, Webex) the ingestion agent makes during a run, capturing at minimum:
  a canonical identifier for the fetched item, a content hash, a timestamp, and the tool
  name and arguments used to make the call.
- **FR-002**: The content hash MUST be computed over the exact bytes returned to the agent
  for that specific call (post-truncation/pagination if the tool applies any), not over
  some other representation of the source item.
- **FR-003**: The system MUST record a ledger entry regardless of whether the ingestion
  agent goes on to cite, summarize, paraphrase, or entirely ignore the fetched content in
  any generated output.
- **FR-004**: The recording mechanism MUST be enforced at a single, shared point that every
  connector's fetches pass through, such that a connector cannot omit or bypass ledger
  recording, whether by oversight or by design.
- **FR-005**: Adding a new source-type connector MUST NOT require any connector-specific
  code to produce ledger entries; using the shared fetch boundary MUST be sufficient.
- **FR-006**: The system MUST record a ledger entry (without a content hash) for a source
  fetch attempt that fails or errors before returning content, distinguishing it from a
  successful fetch.
- **FR-007**: Ledger entries MUST be scoped to the ingestion run that produced them, and
  MUST be retrievable as a complete set for a given run.
- **FR-008**: Ledger entries MUST be surfaced through Tome's evidence-bundle mechanism as a
  new, distinct evidence kind (e.g. `source_fetch`).
- **FR-009**: The new evidence kind MUST be clearly distinguished from the existing
  `github`/`confluence`/`webex` evidence-bundle kinds, which represent LLM-authored
  interpretive pages, not raw source content — introducing the new kind MUST NOT change
  the meaning, labeling, or behavior of any existing evidence kind.
- **FR-010**: The system MUST retain the actual fetched content bytes alongside each ledger
  entry's metadata — not only the content hash — so that a ledger entry can serve directly
  as an independently-captured source snapshot for later semantic verification (e.g. the
  Source Fidelity check described in the companion evaluation design), in addition to
  proving access via the hash.
- **FR-011**: Logged tool-call arguments MUST be redacted or scoped for sensitive content,
  consistent with Tome's existing content-sensitivity handling (e.g. its Gist-exclusion
  default), rather than captured verbatim, wherever an argument could carry free-text
  content (e.g. a GitHub search query, a Confluence CQL filter). This redaction applies to
  the *arguments* of the call; the fetched *content* itself is retained in full per FR-010,
  since redacting it would defeat the ledger's purpose.
- **FR-012**: Ledger entries MUST be retrievable through an externally-accessible interface
  (e.g. an API) so that systems outside Tome — such as the separate evaluation harness
  described in the companion design doc — can retrieve them, in addition to Tome's own
  internal consumption via the evidence bundle. This external surface MUST have its own
  access control and retention policy, tracked independently of other evidence data given
  the raw source content (FR-010) it carries.
- **FR-013**: For each run, the system MUST report the total number of fetches recorded
  (successful and failed) and the total bytes of content fetched (summed across successful
  entries), as a run-level summary available without requiring a consumer to enumerate and
  sum every individual ledger entry itself.

### Key Entities

- **Fetch Ledger Entry**: One record of a single source-system tool call made by the
  ingestion agent during a run. Attributes: canonical URI of the fetched item, the raw
  content bytes returned to the agent, a content hash (sha256) of those bytes (absent on a
  failed fetch), timestamp, tool name, tool arguments (redacted/scoped where they may carry
  sensitive free-text), and success/failure status.
- **Run Ledger**: The complete, ordered set of Fetch Ledger Entries produced by one
  ingestion run, scoped to that run and retrievable as a whole, both internally and via an
  external-facing interface with its own access control and retention policy. Alongside
  its entries, a Run Ledger carries two summary metrics: the total number of fetches
  recorded (successful and failed) and the total bytes of content fetched (summed across
  successful entries' content) for that run.
- **Source-Fetch Evidence Kind**: The evidence-bundle classification (`source_fetch`) under
  which Run Ledger entries are surfaced, distinct from the existing
  `github`/`confluence`/`webex`/`wiki`/`template`/`seed`/`project_snapshot` kinds.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For any completed ingestion run, 100% of source-system fetches made during
  that run have a corresponding ledger entry — there are zero fetches that produce no
  record.
- **SC-002**: A person or system checking whether a specific generated claim matches real
  source content can locate the relevant fetch's ledger entry and read the actual fetched
  content directly from it — verifying both the content itself and its hash against an
  independently-fetched copy — without re-running the ingestion agent.
- **SC-003**: Adding support for a new source-type connector requires zero
  ledger-specific code changes outside the shared fetch boundary, verified by a connector
  implemented with no direct reference to ledger-recording logic still producing complete
  ledger entries.
- **SC-004**: Consumers of the evidence bundle can distinguish raw fetch records from
  LLM-authored source-summary pages 100% of the time, with no existing evidence kind's
  behavior changed by this feature's introduction.
- **SC-005**: A system outside Tome (e.g. a separate evaluation harness in another
  repository) can retrieve a run's complete ledger through an external-facing interface
  without needing direct database or filesystem access to Tome's internals.
- **SC-006**: An operator can see, for any given run, how many fetches were made and how
  much content (in bytes) was fetched, without manually enumerating or summing individual
  ledger entries.

## Assumptions

- The ledger retains full fetched content bytes, not only hashes — chosen so the ledger can
  directly serve as the "independent source snapshot" the companion evaluation design
  needs, at the cost of a larger storage footprint and higher sensitivity than a hash-only
  log. Per the companion design's own caveat, a content hash proves the agent had access to
  specific bytes; it does not by itself prove the agent's generated prose faithfully
  represents them — that remains a separate, later verification step this feature does not
  perform.
- Tool-call *arguments* are redacted/scoped per Tome's existing content-sensitivity rules
  (e.g. Gist exclusion) before being logged, since arguments can carry free-text (search
  queries, CQL filters) independent of the fetched content. The fetched *content* itself
  is retained in full, since redacting it would defeat the ledger's purpose — sensitivity
  handling for that content is instead enforced through the external interface's access
  control (FR-012), not by altering what's stored.
- The external-facing retrieval interface (FR-012) is a new access surface into Tome and is
  assumed to require its own authentication/authorization and retention policy, separate
  from whatever governs Tome's existing internal evidence-bundle consumption — the specific
  mechanism (auth scheme, exact retention duration) is a planning-phase decision, not fixed
  here.
- Failed fetch attempts are logged without a content hash or content bytes, since no bytes
  were returned to the agent to hash or store.
