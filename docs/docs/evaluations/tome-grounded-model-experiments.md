# TOME Grounded Model Experiments

**Audience:** TOME administrators comparing generation models or enforcing grounded drafts.

TOME experiments run two candidate models against one frozen evidence bundle. They preserve every
candidate artifact and use an independent evaluator that does not receive candidate model identities.
An experiment never writes to the live wiki. An administrator must select one evaluated artifact,
which then enters the normal draft review workflow.

## Run an experiment

1. Open **Projects > Admin > Model Evaluations**. This admin-only surface is experimental.
2. Select an entity and operation. Use `synthesize` for an Area or BHAG and `ingest` for a Project.
3. Select distinct candidate models and an evaluator model.
4. Set repeats, seed, turn limit, and a cost ceiling.
5. Launch the run. TOME smoke-tests all three models before spending experiment budget.
6. Compare the blinded artifacts with the normalized rubric radar, then inspect rubric findings,
   claims, cost, and latency.
7. Select an artifact only after the run finishes. The result remains a draft until reviewed.

The evidence bundle includes the entity snapshot, source mirrors, current wiki pages, templates,
seed, and child pages used by synthesis. Every item and the complete bundle have SHA-256 hashes.
Candidate workspaces are reconstructed from this bundle and run without live connector tools.
The run records model provenance, prompt/template hashes, policy version, token usage, turns, cost,
and latency. Repeats use deterministic run identifiers and deterministic-but-balanced blind labels.

The bundle's "ground truth" is the wiki's own prior accepted state, not the originating systems.
Source-mirror pages (GitHub, Confluence, Webex) are themselves LLM-authored summaries produced by
an earlier ingest run; they pass through this same evaluation gate the first time they are written,
then graduate into frozen evidence for later runs once accepted. The evaluator never re-queries the
live source system, so it cannot detect a summary that is internally consistent but unfaithful to the
real GitHub issue, Confluence page, or Webex transcript it was drawn from — only drift or fabrication
relative to what TOME has already accepted.

## Evaluator safeguards

- Candidate models and the evaluator must have versioned TOME capability profiles.
- The evaluator must be independent, support schema-constrained output, and rank above both candidates.
- TOME snapshots the evaluator's context window, output ceiling, and profile version with the run.
- Evaluations are packed into output-aware page batches with a context safety margin.
- Every batch receives the complete frozen evidence bundle. Evidence is never silently truncated.
- Transient provider failures receive bounded retries. Schema failures, refusals, and capacity failures
  remain visible and disable winner selection.
- If no strictly stronger evaluator is configured, the experiment fails preflight instead of using a
  candidate as its own judge.

## Rubrics

Each rubric can be enabled, disabled, blocking, or observational. Ratio rubrics accept a minimum;
negative-count rubrics accept a maximum. Cost and latency report telemetry unless a threshold is set.
The result radar groups the quality rubrics into nine readable dimensions. It inverts negative
finding rates so higher always means better, and excludes cost and latency from the quality shape.
The detailed rubric rows remain the auditable result.

| Group | Rubrics |
|---|---|
| Grounding | Atomic claim inventory, claim evidence, citation coverage/correctness/specificity, grounding score |
| Risk | Unsupported, contradicted, unverifiable, or unsupported critical claims; fabricated entities or quantities |
| Fidelity | Explicit gaps, semantic fidelity, conflict disclosure, source freshness, material coverage, scope fidelity, stable-page preservation |
| Structure | Template compliance, internal-link validity, attribution integrity |
| Operations | Evaluator confidence, cost efficiency, latency efficiency |

The grounding denominator is the evaluator's atomic, checkable claims. Fully supported claims count
as `1`; partially supported claims count as `0.5`. Critical claim categories include KPIs, deadlines,
partners/customers, owners, dependencies, risks, and status assertions. Missing evidence must be
reported as a gap rather than converted into a positive assertion.

## Quality policy precedence

Policies resolve in this order:

1. Exact entity
2. Entity type
3. Global

Modes have these effects:

| Mode | Evaluation | Promotion behavior |
|---|---|---|
| `off` | None | Existing review behavior |
| `observe` | Findings are stored and shown | Findings do not block |
| `enforce` | Missing or failed evaluation fails closed | Blocking rubrics prevent approval and overdue auto-promotion |

An enforced policy may require human review. If steward override is enabled, the reviewer must enter
a reason; the override, actor, policy version, evaluation, and timestamp are retained for audit.
Rejected and losing artifacts are retained.

## Interpretation limits

The evaluator is an LLM judge, not an independent source of truth. Blinding reduces identity bias but
does not remove model bias, shared-provider failure modes, prompt sensitivity, or correlated errors.
Grounding is measured against the frozen evidence bundle, which is prior accepted TOME output, not
the live GitHub, Confluence, or Webex system. An ingestion-time summarization error that entered the
wiki unnoticed becomes trusted evidence for every later run until a human catches and corrects it.
Use multiple repeats, inspect claim-level evidence, and calibrate fixtures before enforcing a policy.
Treat very low evaluator confidence, abstentions, malformed output, or missing required signals as a
review condition. Cost and latency must not substitute for grounding.

The static suite covers absent KPIs/partners, conflicting or stale sources, sparse Project/Area data,
contradictory BHAG children, and stable human-owned pages. Live suites should use representative
entities and a fixed policy version. Record intentional fixture changes as a new suite version so
historical comparisons remain reproducible.
