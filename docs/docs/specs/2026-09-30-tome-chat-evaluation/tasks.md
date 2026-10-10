# Tasks: Chat Transcript Evaluation

**Input**: Design documents from `docs/docs/specs/2026-09-30-tome-chat-evaluation/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/evaluate-chat.md, quickstart.md

**Tests**: Not explicitly requested as TDD in spec.md. Test tasks are still
included per story — this repo's Constitution (`VI. CI Gates Are
Non-Negotiable`) and existing convention (`test_evaluator.py` thoroughly
unit-tests this exact module) require passing tests before shipping, so
each story's tests are written alongside its implementation rather than as
optional polish.

**Organization**: Tasks are grouped by user story (spec.md) to enable
independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps to spec.md user stories (US1, US2, US3)
- File paths are exact and relative to the repository root.

## Path Conventions (from plan.md)

Single existing Python microservice, extended in place:

- `ai_platform_engineering/agents/tome/tome_agent/orchestrator/contract.py` — Pydantic contracts
- `ai_platform_engineering/agents/tome/tome_agent/agent/evaluator.py` — evaluator logic
- `ai_platform_engineering/agents/tome/tome_agent/agent/main.py` — FastAPI routes
- `ai_platform_engineering/agents/tome/tests/test_evaluator.py` — tests
- `ai_platform_engineering/agents/tome/README.md` — endpoint documentation

---

## Phase 1: Setup

**Purpose**: Establish a known-good baseline before touching shared code.

- [x] T001 Run `uv run pytest ai_platform_engineering/agents/tome/tests/test_evaluator.py` from repo root and confirm it passes, establishing the pre-change baseline this feature must not regress (SC-004). (Run via `cd ai_platform_engineering/agents/tome && uv run --with pytest --with pytest-asyncio pytest tests/test_evaluator.py` — pytest is not a declared dependency of this sub-project.)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types and the shared batch-call helper that every user story's implementation needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 [P] Add `ChatTranscriptTurn`, `RubricCriterion`, and `DimensionScore` Pydantic models to `ai_platform_engineering/agents/tome/tome_agent/orchestrator/contract.py` (see data-model.md).
- [x] T003 Add `RelevanceCompletenessResult`, `ChatEvaluationRequest` (with a `model_validator` requiring at least one `assistant` turn in `transcript`), and `ChatEvaluationResponse` to `ai_platform_engineering/agents/tome/tome_agent/orchestrator/contract.py`, and add all six new type names to the module's `__all__` list (contract.py:585-599). Depends on T002.
- [x] T004 Extract a `_run_evaluator_turn(*, request_prompt, system_prompt, output_schema, evaluator_model, max_cost_usd, max_turns, validate)` helper out of `_evaluate_batch` in `ai_platform_engineering/agents/tome/tome_agent/agent/evaluator.py` (research.md: "shared batch-call helper, not a parallel evaluator"), covering the existing retry/attempt/transient-error/structured-output-parsing logic (evaluator.py:653-740). `_evaluate_batch` now delegates to it via a `_validate` closure; no behavior change. (`evaluator_profile` was dropped from the helper's signature — it was only ever used by the caller to decide `output_schema`/`use_structured_output`, never inside the retry loop itself.)
- [x] T005 Run `uv run pytest ai_platform_engineering/agents/tome/tests/test_evaluator.py` and confirm it still passes unmodified after the T004 refactor — this is the regression gate for SC-004 before any chat-specific code is added. (20/20 passed.)

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Verify chat responses are grounded in evidence (Priority: P1) 🎯 MVP

**Goal**: `POST /evaluate/chat` extracts and classifies factual claims from a chat transcript's final assistant answer against a frozen evidence bundle, returning the same claim shape/verdict taxonomy as page evaluation, plus a baseline relevance/completeness result scored against the built-in default rubric (required by the response contract — see data-model.md).

**Independent Test**: Submit a transcript whose final assistant answer mixes a claim backed by the evidence bundle, a claim contradicted by it, and a specific unchecked detail; confirm `claims` returns the right `exact_text`/offsets and `supported`/`contradicted`/`unsupported` classifications, with `critical_kind` and `fabricated_*` fields populated where applicable.

### Implementation for User Story 1

- [x] T006 [US1] Add `_extract_final_assistant_turn(transcript: list[ChatTranscriptTurn]) -> str` in `ai_platform_engineering/agents/tome/tome_agent/agent/evaluator.py`, returning the last `assistant` turn's content (raises `ValueError` when none exists).
- [x] T007 [P] [US1] Add `CHAT_EVALUATOR_PROMPT_VERSION` and a `_CHAT_SYSTEM_PROMPT` constant in `ai_platform_engineering/agents/tome/tome_agent/agent/evaluator.py` — same claim definition, verdict taxonomy, and `critical_kind`/fabrication fields as `_SYSTEM_PROMPT`, rephrased for "the assistant's answer" instead of "candidate pages," and omitting every page-only signal (research.md).
- [x] T008 [US1] Add a `_CHAT_REQUEST_PROMPT_TEMPLATE` and `_chat_request_prompt(body: ChatEvaluationRequest, answer_text: str) -> str` in `ai_platform_engineering/agents/tome/tome_agent/agent/evaluator.py`. Reuse `_estimate_tokens`/`_capacity` to raise `ValueError` when the evidence bundle plus transcript exceed the evaluator's input budget, mirroring the preflight check in `_plan_batches` (no multi-page batching needed — a chat answer is a single unit, per research.md). (Budget check landed as its own `_check_chat_token_budget` helper.)
- [x] T009 [P] [US1] Add `_chat_claims_output_schema(max_claims: int) -> dict` in `ai_platform_engineering/agents/tome/tome_agent/agent/evaluator.py`, modeled on `_quick_direct_output_schema` (evaluator.py:292) but without a `signals` key. (Extracted the shared claim-item fragment into `_compact_claim_item_schema()`, reused by both schemas.)
- [x] T010 [P] [US1] Add a `_DEFAULT_CHAT_RUBRIC: list[RubricCriterion]` constant in `ai_platform_engineering/agents/tome/tome_agent/agent/evaluator.py` with `relevance_default` and `completeness_default` criteria (research.md).
- [x] T011 [US1] Add `_score_relevance_completeness(body: ChatEvaluationRequest, answer_text: str) -> RelevanceCompletenessResult` in `ai_platform_engineering/agents/tome/tome_agent/agent/evaluator.py`: baseline implementation applies `body.rubric or _DEFAULT_CHAT_RUBRIC`, calls `_run_evaluator_turn` (T004) with a rubric-judge system prompt and a `{relevance, completeness}` structured-output schema, and returns `method="rubric"`, `rubric_applied=<the resolved rubric>`. (Folding in the caller-override branch here immediately — rather than deferring it to T018 — turned out to be zero extra cost and avoids a churn-y second edit to the same line; T018 is now just the "no change needed" acceptance-test task for that already-present behavior.)
- [x] T012 [US1] Add `async def evaluate_chat_transcript(body: ChatEvaluationRequest) -> ChatEvaluationResponse` in `ai_platform_engineering/agents/tome/tome_agent/agent/evaluator.py`: extracts the final assistant answer (T006), runs claim extraction through `_run_evaluator_turn` using T007/T008/T009, runs `_score_relevance_completeness` (T011), merges tokens/turns/cost/attempts from both calls, sets `batches=1`, and returns the combined `ChatEvaluationResponse`. Depends on T003, T004, T006-T011.
- [x] T013 [US1] Add `POST /evaluate/chat` route in `ai_platform_engineering/agents/tome/tome_agent/agent/main.py`, calling `evaluate_chat_transcript`, following the existing `/evaluate` route's `503` (not ready) / `502` (`ValueError` → `HTTPException`) pattern (main.py:453-463). Import `evaluate_chat_transcript`, `ChatEvaluationRequest`, `ChatEvaluationResponse` alongside the existing evaluator imports (main.py:60).
- [x] T014 [US1] Add unit tests in `ai_platform_engineering/agents/tome/tests/test_evaluator.py` (named so `pytest -k chat` selects them): prompt/schema construction for `_chat_request_prompt`/`_chat_claims_output_schema`; `supported`/`unsupported`/`contradicted` classification end to end; `fabricated_entities`/`fabricated_quantitative_details` populated correctly; the missing-assistant-turn validation error; and the token-budget-exceeded `ValueError`. (6 new tests; `pytest -k chat` → 6 passed, `pytest -k "not chat"` → 20 passed.)

**Checkpoint**: `POST /evaluate/chat` returns real claim verdicts plus a default-rubric relevance/completeness result. Re-run `uv run pytest ai_platform_engineering/agents/tome/tests/test_evaluator.py -k "not chat"` to confirm existing `/evaluate` tests are untouched (SC-004).

---

## Phase 4: User Story 2 - Score a chat response against a reference answer (Priority: P2)

**Goal**: When the caller supplies `reference_answer`, relevance/completeness is scored against it instead of a rubric.

**Independent Test**: Submit the same transcript/evidence bundle twice with two different reference answers (one closely matching the assistant's answer, one substantially different) and confirm relevance/completeness scores move accordingly, with `method="reference_answer"` and `rubric_applied=None`.

### Implementation for User Story 2

- [x] T015 [US2] Add a reference-answer judge system prompt constant in `ai_platform_engineering/agents/tome/tome_agent/agent/evaluator.py` that compares the assistant's answer to a supplied reference answer and scores relevance/completeness with rationale and findings.
- [x] T016 [US2] Extend `_score_relevance_completeness` (T011) in `ai_platform_engineering/agents/tome/tome_agent/agent/evaluator.py`: when `body.reference_answer` is set, use the T015 prompt instead of the rubric prompt, return `method="reference_answer"` and `rubric_applied=None` — this branch takes precedence over any `body.rubric` the caller also supplied (contracts/evaluate-chat.md Edge Cases). Depends on T011, T015.
- [x] T017 [US2] Add unit tests in `ai_platform_engineering/agents/tome/tests/test_evaluator.py`: closely-matching reference → high relevance/completeness scores; reference covering extra points the answer omits → lower completeness with a specific finding; reference addressing a different question → low relevance; and a request with both `reference_answer` and `rubric` set → `reference_answer` wins (`method="reference_answer"`).

**Checkpoint**: US1 and US2 both work independently — supplying `reference_answer` changes the scoring method without touching claim extraction behavior.

---

## Phase 5: User Story 3 - Score a chat response using a rubric when no reference answer exists (Priority: P3)

**Goal**: Harden the default-rubric path stood up in US1 (T010/T011) with full acceptance coverage, and let callers override the default rubric with custom criteria (FR-006).

**Independent Test**: Submit a transcript/evidence bundle with no `reference_answer`: (a) with no custom `rubric` — confirm `_DEFAULT_CHAT_RUBRIC` is applied and returned in `rubric_applied`; (b) with a custom `rubric` — confirm that rubric is applied and returned instead; (c) with an assistant answer unrelated to the evidence bundle's subject matter — confirm a low relevance score.

### Implementation for User Story 3

- [x] T018 [US3] Extend `_score_relevance_completeness` (T011/T016) in `ai_platform_engineering/agents/tome/tome_agent/agent/evaluator.py`: when `reference_answer` is absent, use `body.rubric` if the caller supplied one, else `_DEFAULT_CHAT_RUBRIC` (T010); always set `rubric_applied` to whichever rubric was actually used. (No code change needed — T011 already implemented `rubric = body.rubric or _DEFAULT_CHAT_RUBRIC`; this task is satisfied by existing code, verified by T019's tests.)
- [x] T019 [US3] Add unit tests in `ai_platform_engineering/agents/tome/tests/test_evaluator.py`: default rubric applied and reported when neither `reference_answer` nor `rubric` is supplied (already covered by T014's `test_chat_evaluation_classifies_claims_and_scores_default_rubric`); a custom `rubric` is applied and reported when supplied; and a low relevance score when the assistant's answer doesn't address the evidence bundle's subject matter at all.

**Checkpoint**: All three user stories are independently functional; the full chat-evaluation feature set (FR-001 through FR-009) is implemented.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T020 [P] Add a `POST /evaluate/chat` row to the endpoint table in `ai_platform_engineering/agents/tome/README.md` (next to the existing `/evaluate` row at line 24), per the Constitution's "Component READMEs" documentation rule.
- [x] T021 Run `uv run ruff check` and `uv run pytest` across `ai_platform_engineering/agents/tome/` from repo root and confirm both pass (CLAUDE.md Quality Gates / Constitution VI). (`tome_agent` is its own uv sub-project with no `ruff`/`pytest` dev dependency declared, so both tools were run as ephemeral `uv run --with` packages from inside `ai_platform_engineering/agents/tome/`. `ruff check` on the four touched files — `evaluator.py`, `main.py`, `contract.py`, `test_evaluator.py` — passes clean under this sub-project's own resolved config. The full `ruff check .` over the whole sub-project reports 33 pre-existing findings, none in a line this feature added or touched — all in files untouched by this feature (`metrics.py`, `tracing.py`, `prompts/__init__.py`, `mcp_github.py`, `wiki_steering.py`, connectors, scripts); out of scope to fix here. `uv run pytest tests/` — full sub-project suite, not just `test_evaluator.py` — passes 172/172 with no regressions.)
- [x] T022 Walk through the `quickstart.md` curl examples (default-rubric path and reference-answer path) against a locally running `tome_agent` instance to manually confirm end-to-end behavior matches contracts/evaluate-chat.md. (Ran a FastAPI `TestClient` smoke test instead of the literal curl walkthrough — the quickstart's curl examples require a live `ANTHROPIC_API_KEY` and would spend real model cost on every run, which wasn't warranted just to confirm wiring. The `TestClient` check exercises the actual HTTP layer the unit tests don't — bearer-token auth enforcement [401 with no token], request validation at the wire [422 on a transcript with no assistant turn, matching `ChatEvaluationRequest`'s validator], and the response contract shape [200 with `relevance_completeness.method`/scores present] — with `evaluate_chat_transcript` mocked so no real model call occurs. All three passed. The LLM-calling path itself (prompt construction, retries, response parsing) is covered by T014/T017/T019's mocked-`query` unit tests, not by this task.)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational. No dependency on US2/US3.
- **User Story 2 (Phase 4)**: Depends on Foundational and on US1's `_score_relevance_completeness` (T011) existing to extend. Independently testable once added.
- **User Story 3 (Phase 5)**: Depends on Foundational and on US1's T011 (and, textually, comes after US2's T016 in the file, but does not depend on US2's reference-answer behavior — only on T011's rubric branch). Independently testable once added.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- Contract/type tasks before orchestration-function tasks.
- Orchestration-function tasks before the route task.
- Implementation before its tests.
- Story complete (checkpoint passes) before moving to the next priority.

### Parallel Opportunities

- T002 can run in parallel with starting T004 (different files: contract.py vs. evaluator.py); T003 depends on T002 (same file).
- Within US1: T007, T009, T010 are independent additions to evaluator.py and are marked `[P]` relative to each other, but note they land in the same file as T006/T008/T011/T012 — apply them as separate, non-overlapping edits rather than literally concurrent processes if working solo.
- US2 (Phase 4) and US3 (Phase 5) both extend the same function (`_score_relevance_completeness`) added in US1 — they are logically independent (different `if` branches) but physically touch the same file/function, so treat them as sequential work within a single contributor's session even though they don't depend on each other's logic.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (US1): `POST /evaluate/chat` returns claim verdicts + default-rubric relevance/completeness.
3. **STOP and VALIDATE**: run the Phase 3 checkpoint, confirm SC-004 (existing `/evaluate` behavior unchanged).
4. This is a legitimate MVP: grounding verification is the feature's primary value (spec.md User Story 1 rationale).

### Incremental Delivery

1. Setup + Foundational → Foundation ready.
2. US1 → validate independently → MVP.
3. US2 → validate independently (reference-answer scoring available).
4. US3 → validate independently (custom rubric override + off-topic low-relevance coverage).
5. Polish.

---

## Notes

- `[P]` tasks touch different files or independent constants; verify no overlapping edits before running them concurrently.
- `[Story]` labels map every user-story-phase task back to spec.md's US1/US2/US3.
- Re-run `uv run pytest ai_platform_engineering/agents/tome/tests/test_evaluator.py -k "not chat"` after each phase to keep confirming SC-004 (zero behavior change to existing `/evaluate`).
- Commit after each task or logical group, per repository git guidelines (Conventional Commits, DCO sign-off).
