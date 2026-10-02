# Phase 1 Data Model: Chat Transcript Evaluation

All new types are added to
`ai_platform_engineering/agents/tome/tome_agent/orchestrator/contract.py`,
alongside the existing `ArtifactEvaluationRequest`/`ArtifactEvaluationResponse`
(contract.py:547-573). None of the existing types change.

## ChatTranscriptTurn

One turn of the conversation being evaluated.

| Field | Type | Notes |
|---|---|---|
| `role` | `Literal["user", "assistant"]` | Only these two roles are evaluated; tool/system turns are out of scope for this feature. |
| `content` | `str` | Turn text. |

**Validation**: `transcript` on the request must contain at least one
`assistant` turn (FR-002; see Edge Cases in spec.md for the empty case) —
enforced by a `model_validator` on `ChatEvaluationRequest`, returning the
same `ValueError` → HTTP 502 pattern the existing `/evaluate` route uses for
`evaluate_artifact` failures.

## RubricCriterion

One scoring criterion, used for both the built-in default rubric and any
caller-supplied override.

| Field | Type | Notes |
|---|---|---|
| `id` | `str` | Stable identifier, e.g. `relevance_default`. |
| `description` | `str` | The criterion the judge model scores against. |
| `weight` | `float` (`gt=0`, default `1.0`) | Reserved for future weighted aggregation; a single-criterion rubric ignores it. |

## DimensionScore

The result of scoring one dimension (relevance or completeness).

| Field | Type | Notes |
|---|---|---|
| `score` | `float` (`ge=0`, `le=1`) | Numeric score for this dimension (spec Assumptions: numeric, not categorical). |
| `rationale` | `str` | Concise explanation the judge model gives for the score. |
| `findings` | `list[str]` (default `[]`) | Specific gaps or mismatches, e.g. "reference answer mentions the Q3 deadline; assistant answer omits it." |

## RelevanceCompletenessResult

| Field | Type | Notes |
|---|---|---|
| `method` | `Literal["reference_answer", "rubric"]` | Which scoring path produced this result — `reference_answer` when the caller supplied one, else `rubric`. |
| `relevance` | `DimensionScore` | — |
| `completeness` | `DimensionScore` | — |
| `rubric_applied` | `list[RubricCriterion] \| None` | The rubric actually used (default or caller override); `None` when `method == "reference_answer"`. |

## ChatEvaluationRequest

Mirrors `ArtifactEvaluationRequest`'s evaluator-selection fields; replaces
page-specific fields (`entity_type`, `candidate_pages`,
`required_template_paths`, `live_stable_pages`) with `transcript`, and adds
the optional relevance/completeness inputs.

| Field | Type | Notes |
|---|---|---|
| `blind_label` | `str` | Same meaning as today — the blinded identifier for this candidate. |
| `evaluator_model` | `str` | Same as `ArtifactEvaluationRequest`. |
| `evaluator_profile` | `EvaluatorModelProfile \| None` | Same as `ArtifactEvaluationRequest` (contract.py:538). |
| `evaluator_prompt_version` | `str \| None` | Selects among chat-specific prompt versions (see Contracts). |
| `max_claims` | `int \| None` (`1..50`) | Same meaning as today. |
| `transcript` | `list[ChatTranscriptTurn]` | The conversation being evaluated. At least one `assistant` turn required. |
| `evidence` | `list[EvaluationEvidenceItem]` | Unchanged type from page evaluation (contract.py:472). |
| `reference_answer` | `str \| None` | When present, relevance/completeness is scored against this answer (FR-005). |
| `rubric` | `list[RubricCriterion] \| None` | Caller override for the default rubric; ignored when `reference_answer` is present. |
| `max_cost_usd` | `float \| None` (`gt=0`) | Same meaning as today; applies to the combined claim-extraction + relevance/completeness cost. |

## ChatEvaluationResponse

| Field | Type | Notes |
|---|---|---|
| `claims` | `list[EvaluationClaim]` | Reuses the existing claim type unchanged (contract.py:486); `page` is set to a fixed sentinel (e.g. `"transcript"`) since chat has no page path. |
| `relevance_completeness` | `RelevanceCompletenessResult` | Always present — either reference-answer- or rubric-derived (FR-005/FR-006). |
| `tokens` | `dict[str, int]` (default `{}`) | Summed across the claim-extraction call and the relevance/completeness call. |
| `turns` | `int` (default `1`) | Summed across both calls. |
| `cost_usd` | `float \| None` | Summed across both calls when both report cost. |
| `batches` | `int` (`ge=1`, default `1`) | Always `1` — chat evaluation is a single answer, not a multi-page batch plan (see research.md). |
| `attempts` | `int` (`ge=1`, default `1`) | Summed retry attempts across both calls. |

No `signals` field — see research.md, "Chat claim extraction omits the
page-only signals block."

## State / Lifecycle

This feature introduces no persisted state and no state machine — every
request is evaluated synchronously and the response is returned without
being written to storage, identical to `/evaluate` today.
