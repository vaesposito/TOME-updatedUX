# Phase 0 Research: Chat Transcript Evaluation

No `[NEEDS CLARIFICATION]` markers remained in the Technical Context — the
spec's Assumptions section already resolved the open scope questions. This
document records the resulting implementation-level decisions.

## Decision: Reuse via a shared batch-call helper, not a parallel evaluator

**Decision**: Extract the retry/attempt/structured-output-parsing body of
`_evaluate_batch` (`ai_platform_engineering/agents/tome/tome_agent/agent/evaluator.py:653`)
into a small helper — `_run_evaluator_turn(*, request_prompt, system_prompt,
output_schema, evaluator_model, evaluator_profile, max_cost_usd, max_turns)`
— that returns the raw parsed payload plus telemetry (tokens, turns, cost).
Both `_evaluate_batch` (page path) and the new chat claim-extraction call
delegate to it.

**Rationale**: FR-002/FR-003 require identical claim schema, verdict
taxonomy, and error/retry semantics between page and chat evaluation. Pulling
this out at the second call site is not speculative reuse (Rule of Three
tolerates duplication until the third occurrence) — it is required because
the two call sites must not drift in behavior, and the feature request
explicitly asks to reuse "evaluator.py's claim-extraction machinery."

**Alternatives considered**:
- *Duplicate the retry/parsing logic in a new `_evaluate_chat_batch`
  function.* Rejected: guarantees behavioral drift over time (e.g. a
  transient-error fix applied to one path and not the other) and directly
  contradicts the spec's explicit reuse requirement.
- *Make `ArtifactEvaluationRequest`/`evaluate_artifact` accept a transcript
  in place of `candidate_pages`.* Rejected: `entity_type`,
  `required_template_paths`, and `live_stable_pages` are page/template
  concepts with no chat analog, and the 7 page-only signals
  (`scope_fidelity`, `stable_page_preservation`, etc.) do not apply to a
  chat answer. Overloading the existing contract risks the production
  experiment-runner path (`ui/src/lib/tome/experiment-runner.ts`) that
  depends on today's exact request/response shape (SC-004).

## Decision: Chat claim extraction omits the page-only signals block

**Decision**: The chat claim-extraction system prompt asks only for
`claims` (same shape as page evaluation: `exact_text`, offsets,
`classification`, `critical_kind`, `fabricated_entities`,
`fabricated_quantitative_details`), not the `signals` object
(`explicit_gaps`, `semantic_fidelity`, `conflict_disclosure`,
`source_freshness`, `material_coverage`, `scope_fidelity`,
`stable_page_preservation`).

**Rationale**: Every one of the seven signals is defined in terms of pages,
templates, or stable/live content (`_SYSTEM_PROMPT` in `evaluator.py:26-45`)
— none translate to a single chat answer. YAGNI: do not stub fields that
have no meaningful chat interpretation.

**Alternatives considered**: Returning an empty/zeroed `signals` object for
API-shape symmetry with `ArtifactEvaluationResponse`. Rejected: an empty
object with no real meaning invites misuse (e.g. a caller computing a
pass-rate over zero-total signals); `ChatEvaluationResponse` is a distinct
type and is free to omit the field entirely.

## Decision: Relevance/completeness is a second, optional bounded LLM call

**Decision**: After claim extraction, when the request needs
relevance/completeness scoring (always — either via `reference_answer` or a
rubric, per spec FR-005/FR-006), issue one additional Claude Messages call
(same direct-request pattern as `_evaluate_quick_direct`,
`evaluator.py:595`) with a small judge prompt and a structured
`{relevance: DimensionScore, completeness: DimensionScore}` output schema.

**Rationale**: Keeps claim extraction (a per-claim, evidence-grounded audit)
and relevance/completeness (a whole-answer quality judgment) as separate,
independently testable concerns — consistent with the spec's independently
testable user stories (P1 vs. P2/P3). A single combined call would force one
system prompt to do two very different jobs (per-claim verification vs.
whole-answer judgment), which the deep evaluator prompt shows is already a
prompt-complexity concern with `signals` (`_SYSTEM_PROMPT` in `evaluator.py`).

**Alternatives considered**: Folding relevance/completeness fields into the
same structured-output schema as the claims call. Rejected: it would
couple the chat claims schema to a concern (relevance/completeness) that has
its own optional inputs (`reference_answer` XOR `rubric`), complicating the
one schema more than running one extra bounded call.

## Decision: Built-in default rubric ships in `evaluator.py`

**Decision**: Define `_DEFAULT_CHAT_RUBRIC: list[RubricCriterion]` with two
criteria — `relevance_default` ("directly addresses the user's actual
question, without unrelated or off-topic content") and
`completeness_default` ("covers all evidence-relevant aspects needed to
fully answer the question, without omitting material information available
in the evidence bundle"). Used whenever `reference_answer` is absent and the
caller does not supply a custom `rubric`.

**Rationale**: Spec FR-006 requires relevance/completeness scoring to always
be available without a reference answer; a caller-supplied rubric on every
request would block adoption for exploratory use (spec User Story 3
rationale).

**Alternatives considered**: Requiring every caller to supply a rubric.
Rejected by the spec's own Assumptions section (a built-in default is
always available; callers may override it).
