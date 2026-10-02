import json

import pytest
from claude_agent_sdk import ResultMessage
from pydantic import ValidationError

from tome_agent.agent import evaluator
from tome_agent.agent.evaluator import (
    __test__,
    _extract_json,
    evaluate_artifact,
    evaluate_chat_transcript,
    evaluator_prompt_contract,
)
from tome_agent.orchestrator.contract import (
    ArtifactEvaluationRequest,
    ArtifactEvaluationResponse,
    ChatEvaluationRequest,
    ChatEvaluationResponse,
    EvaluatorModelProfile,
)

SIGNAL_NAMES = (
    "explicit_gaps",
    "semantic_fidelity",
    "conflict_disclosure",
    "source_freshness",
    "material_coverage",
    "scope_fidelity",
    "stable_page_preservation",
)


def valid_payload() -> dict:
    return {
        "claims": [
            {
                "id": "claim-1",
                "page": "overview.md",
                "section": "Status",
                "exact_text": "The milestone is due Friday.",
                "start_offset": 10,
                "end_offset": 38,
                "classification": "unsupported",
                "reason": "No deadline appears in frozen evidence.",
                "confidence": 0.98,
                "abstained": False,
                "citations": [],
                "evidence": [],
                "critical_kind": "date_or_deadline",
                "fabricated_entities": [],
                "fabricated_quantitative_details": ["Friday"],
            }
        ],
        "signals": {
            name: {
                "passed": 0,
                "total": 1,
                "findings": ["Invented date"] if name == "explicit_gaps" else [],
            }
            for name in SIGNAL_NAMES
        },
    }


def evaluator_profile(**overrides: object) -> EvaluatorModelProfile:
    values = {
        "model_id": "provider/model-judge",
        "profile_version": 1,
        "capability_rank": 300,
        "context_window_tokens": 200_000,
        "max_output_tokens": 64_000,
        "supports_structured_output": True,
    }
    values.update(overrides)
    return EvaluatorModelProfile(**values)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def evaluation_request(**overrides: object) -> ArtifactEvaluationRequest:
    values = {
        "blind_label": "candidate-x",
        "evaluator_model": "provider/model-judge",
        "evaluator_profile": evaluator_profile(),
        "evaluator_prompt_version": "tome-grounded-evaluator-v2",
        "entity_type": "project",
        "candidate_pages": {"activity.md": "Example output"},
        "evidence": [],
        "required_template_paths": ["activity.md"],
        "live_stable_pages": {},
    }
    values.update(overrides)
    return ArtifactEvaluationRequest(**values)


def chat_request(**overrides: object) -> ChatEvaluationRequest:
    values = {
        "blind_label": "chat-candidate-x",
        "evaluator_model": "provider/model-judge",
        "evaluator_profile": evaluator_profile(),
        "evaluator_prompt_version": "tome-chat-evaluator-v1",
        "transcript": [
            {"role": "user", "content": "What is the status?"},
            {"role": "assistant", "content": "Example output"},
        ],
        "evidence": [],
    }
    values.update(overrides)
    return ChatEvaluationRequest(**values)


@pytest.mark.parametrize(
    "rendered",
    [
        lambda value: json.dumps(value),
        lambda value: f"```json\n{json.dumps(value)}\n```",
        lambda value: f"Result follows: {json.dumps(value)} done",
    ],
)
def test_extract_json_accepts_common_model_wrappers(rendered) -> None:
    payload = valid_payload()
    assert _extract_json(rendered(payload)) == payload


def test_evaluation_contract_rejects_unknown_claim_classification() -> None:
    payload = valid_payload()
    payload["claims"][0]["classification"] = "probably"
    with pytest.raises(ValidationError):
        ArtifactEvaluationResponse.model_validate(payload)


def test_evaluation_contract_rejects_out_of_range_confidence() -> None:
    payload = valid_payload()
    payload["claims"][0]["confidence"] = 1.2
    with pytest.raises(ValidationError):
        ArtifactEvaluationResponse.model_validate(payload)


def test_evaluation_contract_normalizes_legacy_string_null_critical_kind() -> None:
    payload = valid_payload()
    payload["claims"][0]["critical_kind"] = "null"

    response = ArtifactEvaluationResponse.model_validate(payload)

    assert response.claims[0].critical_kind is None


def test_evaluation_contract_rejects_other_unknown_critical_kinds() -> None:
    payload = valid_payload()
    payload["claims"][0]["critical_kind"] = "other"
    with pytest.raises(ValidationError):
        ArtifactEvaluationResponse.model_validate(payload)


def test_evaluator_prompt_contract_is_versioned_and_read_only() -> None:
    contract = evaluator_prompt_contract()

    assert contract.version == "tome-grounded-evaluator-v2"
    assert contract.editable is False
    assert "strict evidence auditor" in contract.system_prompt
    assert '"critical_kind":null' in contract.system_prompt
    assert 'string "null"' in contract.system_prompt
    assert "{candidate_pages}" in contract.request_template
    assert "{frozen_evidence}" in contract.request_template


def test_quick_evaluator_prompt_contract_is_bounded() -> None:
    contract = evaluator_prompt_contract("quick")

    assert contract.version == "tome-quick-evaluator-v1"
    assert "most material" in contract.system_prompt
    assert "empty signals object" in contract.system_prompt


def test_request_prompt_renders_the_published_template() -> None:
    body = evaluation_request()

    prompt = __test__["request_prompt"](body)

    assert "Blind candidate label: candidate-x" in prompt
    assert '<candidate_pages>{"activity.md": "Example output"}</candidate_pages>' in prompt
    assert "<frozen_evidence>[]</frozen_evidence>" in prompt


def test_structured_output_schema_is_strict_and_excludes_runtime_telemetry() -> None:
    schema = __test__["structured_output_schema"]()

    assert schema["additionalProperties"] is False
    assert schema["properties"]["signals"]["required"] == list(SIGNAL_NAMES)
    assert "tokens" not in schema["properties"]
    assert "batches" not in schema["properties"]
    assert "input_budget_tokens" not in schema["properties"]
    rendered = json.dumps(schema)
    assert '"minimum"' not in rendered
    assert '"maximum"' not in rendered


def test_quick_structured_output_schema_omits_deep_signals() -> None:
    schema = __test__["structured_output_schema"](quick=True)

    assert schema["properties"]["signals"]["properties"] == {}
    assert schema["properties"]["signals"]["required"] == []
    assert schema["properties"]["claims"]["maxItems"] == 12
    assert "EvaluationSignal" not in schema["$defs"]


def test_batch_planner_preserves_every_page_without_truncating_evidence() -> None:
    pages = {f"page-{index}.md": "content" for index in range(21)}
    body = evaluation_request(candidate_pages=pages)

    batches = __test__["plan_batches"](body, evaluator_prompt_contract().system_prompt)

    assert len(batches) == 3
    assert all(len(batch.candidate_pages) <= 8 for batch in batches)
    assert {
        path for batch in batches for path in batch.candidate_pages
    } == set(pages)


def test_batch_planner_fails_when_frozen_evidence_exceeds_capacity() -> None:
    body = evaluation_request(
        evaluator_profile=evaluator_profile(
            context_window_tokens=1_000,
            max_output_tokens=100,
        ),
        evidence=[{
            "id": "evidence-1",
            "canonical_uri": "https://example.test/evidence",
            "content_hash": "example-hash",
            "content": "x" * 5_000,
        }],
    )

    with pytest.raises(ValueError, match="evidence was not truncated"):
        __test__["plan_batches"](body, evaluator_prompt_contract().system_prompt)


@pytest.mark.anyio
async def test_evaluator_uses_structured_output_and_request_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    messages = [
        ResultMessage(
            subtype="success",
            duration_ms=1,
            duration_api_ms=1,
            is_error=False,
            num_turns=1,
            session_id="session-2",
            result="",
            structured_output=valid_payload(),
            usage={"input_tokens": 10, "output_tokens": 20},
            total_cost_usd=0.01,
        ),
    ]
    seen_options = []

    async def fake_query(*, prompt: str, options: object):
        assert "candidate_pages" in prompt
        seen_options.append(options)
        yield messages.pop(0)

    monkeypatch.setattr(evaluator, "query", fake_query)

    response = await evaluate_artifact(evaluation_request(max_cost_usd=0.5))

    assert response.attempts == 1
    assert response.batches == 1
    assert response.tokens == {"input": 10, "output": 20}
    assert response.peak_estimated_input_tokens < response.input_budget_tokens
    assert response.output_budget_tokens == 32_000
    assert all(option.output_format["type"] == "json_schema" for option in seen_options)
    assert all(option.max_turns == 6 for option in seen_options)
    assert all(option.max_budget_usd == 0.5 for option in seen_options)


@pytest.mark.anyio
async def test_quick_evaluator_caps_claim_prompt_and_turns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    payload = valid_payload()
    payload["signals"] = {}
    payload["claims"][0]["exact_text"] = "Example output"
    seen: list[tuple[str, object]] = []

    async def fake_query(*, prompt: str, options: object):
        seen.append((prompt, options))
        yield ResultMessage(
            subtype="success",
            duration_ms=1,
            duration_api_ms=1,
            is_error=False,
            num_turns=1,
            session_id="session-quick",
            result="",
            structured_output=payload,
        )

    monkeypatch.setattr(evaluator, "query", fake_query)

    response = await evaluate_artifact(evaluation_request(
        evaluator_prompt_version="tome-quick-evaluator-v1",
        evaluation_mode="quick",
        max_claims=12,
    ))

    assert len(response.claims) == 1
    assert "Maximum material claims to return: 12" in seen[0][0]
    assert seen[0][1].max_turns == 4
    assert seen[0][1].output_format is None


@pytest.mark.anyio
async def test_quick_evaluator_normalizes_compact_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    async def fake_query(*, prompt: str, options: object):
        yield ResultMessage(
            subtype="success",
            duration_ms=1,
            duration_api_ms=1,
            is_error=False,
            num_turns=1,
            session_id="session-quick-compact",
            result=json.dumps({
                "claims": [{
                    "exact_text": "Example output",
                    "classification": "supported",
                    "reason": "Frozen evidence matches.",
                    "confidence": 0.9,
                    "evidence": [],
                    "critical_kind": None,
                    "fabricated_entities": [],
                    "fabricated_quantitative_details": [],
                }],
                "signals": {},
            }),
        )

    monkeypatch.setattr(evaluator, "query", fake_query)

    response = await evaluate_artifact(evaluation_request(
        evaluator_prompt_version="tome-quick-evaluator-v1",
        evaluation_mode="quick",
        max_claims=12,
    ))

    assert response.claims[0].page == "activity.md"
    assert response.claims[0].start_offset == 0
    assert response.claims[0].end_offset == len("Example output")
    assert response.claims[0].id.startswith("quick-1-")


@pytest.mark.anyio
async def test_quick_evaluator_uses_direct_messages_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict[str, object] = {}

    class FakeResponse:
        status_code = 200
        text = "ok"

        def __init__(self) -> None:
            self.headers = {"x-litellm-response-cost": "0.03"}

        @staticmethod
        def json() -> dict:
            return {
                "content": [{
                    "type": "text",
                    "text": json.dumps({
                        "claims": [{
                            "exact_text": "Example output",
                            "classification": "supported",
                            "reason": "Matched.",
                            "confidence": 0.9,
                            "evidence": [],
                            "critical_kind": None,
                            "fabricated_entities": [],
                            "fabricated_quantitative_details": [],
                        }],
                        "signals": {},
                    }),
                }],
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 20, "output_tokens": 10},
            }

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        async def post(self, url: str, **kwargs: object) -> FakeResponse:
            seen.update({"url": url, **kwargs})
            return FakeResponse()

    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://llm.example.test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(evaluator.httpx, "AsyncClient", lambda **_: FakeClient())

    response = await evaluate_artifact(evaluation_request(
        evaluator_prompt_version="tome-quick-evaluator-v1",
        evaluation_mode="quick",
        max_claims=4,
    ))

    assert seen["url"] == "https://llm.example.test/v1/messages"
    request_json = seen["json"]
    assert request_json["max_tokens"] == 4_096
    output_format = request_json["output_config"]["format"]
    assert output_format["type"] == "json_schema"
    assert output_format["schema"]["properties"]["claims"]["maxItems"] == 4
    assert response.claims[0].exact_text == "Example output"
    assert response.tokens == {"input": 20, "output": 10}
    assert response.cost_usd == 0.03


@pytest.mark.anyio
async def test_evaluator_splits_batch_after_bounded_turn_exhaustion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    async def fake_query(*, prompt: str, options: object):
        calls.append(prompt)
        if '"one.md"' in prompt and '"two.md"' in prompt:
            yield ResultMessage(
                subtype="error_max_turns",
                duration_ms=1,
                duration_api_ms=1,
                is_error=True,
                num_turns=6,
                session_id="session-capacity",
                result="error_max_turns",
            )
            return
        yield ResultMessage(
            subtype="success",
            duration_ms=1,
            duration_api_ms=1,
            is_error=False,
            num_turns=2,
            session_id="session-success",
            result="",
            structured_output=valid_payload(),
        )

    monkeypatch.setattr(evaluator, "query", fake_query)

    response = await evaluate_artifact(
        evaluation_request(candidate_pages={"one.md": "one", "two.md": "two"})
    )

    assert len(calls) == 3
    assert response.batches == 2
    assert response.attempts == 3


@pytest.mark.anyio
async def test_evaluator_does_not_retry_refusal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0

    async def fake_query(*, prompt: str, options: object):
        nonlocal calls
        calls += 1
        yield ResultMessage(
            subtype="success",
            duration_ms=1,
            duration_api_ms=1,
            is_error=False,
            num_turns=1,
            session_id="session-refusal",
            result="Request refused",
            stop_reason="refusal",
        )

    monkeypatch.setattr(evaluator, "query", fake_query)

    with pytest.raises(ValueError, match="human review"):
        await evaluate_artifact(evaluation_request())
    assert calls == 1


# ---------- chat evaluation (POST /evaluate/chat) ----------


def chat_claim_payload() -> dict:
    return {
        "claims": [
            {
                "exact_text": "The launch is on 2026-01-01",
                "classification": "contradicted",
                "reason": "Evidence says 2026-02-01.",
                "confidence": 0.9,
                "evidence": [{
                    "evidence_item_id": "evidence-1",
                    "quote": "Launch date is 2026-02-01.",
                }],
                "critical_kind": "date_or_deadline",
                "fabricated_entities": [],
                "fabricated_quantitative_details": [],
            },
            {
                "exact_text": "owned by the payments team",
                "classification": "supported",
                "reason": "Matches evidence.",
                "confidence": 0.95,
                "evidence": [{
                    "evidence_item_id": "evidence-1",
                    "quote": "Owner: payments team.",
                }],
                "critical_kind": "ownership",
                "fabricated_entities": [],
                "fabricated_quantitative_details": [],
            },
        ],
    }


def relevance_completeness_payload() -> dict:
    return {
        "relevance": {
            "score": 0.9,
            "rationale": "Answers the question asked.",
            "findings": [],
        },
        "completeness": {
            "score": 0.6,
            "rationale": "Misses the blocked status noted in evidence.",
            "findings": ["Evidence also notes the migration is blocked on a schema review."],
        },
    }


def chat_result_message(session_id: str, structured_output: dict, **overrides: object) -> ResultMessage:
    values = {
        "subtype": "success",
        "duration_ms": 1,
        "duration_api_ms": 1,
        "is_error": False,
        "num_turns": 1,
        "session_id": session_id,
        "result": "",
        "structured_output": structured_output,
        "usage": {"input_tokens": 10, "output_tokens": 20},
        "total_cost_usd": 0.01,
    }
    values.update(overrides)
    return ResultMessage(**values)


def test_chat_request_requires_an_assistant_turn() -> None:
    with pytest.raises(ValidationError, match="assistant turn"):
        chat_request(transcript=[{"role": "user", "content": "Hello?"}])


def test_chat_request_prompt_includes_answer_and_evidence() -> None:
    body = chat_request(
        evidence=[{
            "id": "evidence-1",
            "canonical_uri": "https://example.test/evidence",
            "content_hash": "example-hash",
            "content": "Launch date is 2026-02-01.",
        }],
    )

    prompt = evaluator._chat_request_prompt(body, "Example output")

    assert "Example output" in prompt
    assert "Launch date is 2026-02-01." in prompt
    assert "chat-candidate-x" in prompt


def test_chat_claims_output_schema_omits_signals() -> None:
    schema = evaluator._chat_claims_output_schema(max_claims=5)

    assert schema["properties"]["claims"]["maxItems"] == 5
    assert "signals" not in schema["properties"]
    assert schema["required"] == ["claims"]


def test_chat_token_budget_check_rejects_oversized_evidence() -> None:
    body = chat_request(
        evaluator_profile=evaluator_profile(
            context_window_tokens=1_000,
            max_output_tokens=100,
        ),
        evidence=[{
            "id": "evidence-1",
            "canonical_uri": "https://example.test/evidence",
            "content_hash": "example-hash",
            "content": "x" * 5_000,
        }],
    )
    request_prompt = evaluator._chat_request_prompt(body, "Example output")

    with pytest.raises(ValueError, match="evaluator input budget"):
        evaluator._check_chat_token_budget(body, evaluator._CHAT_SYSTEM_PROMPT, request_prompt)


@pytest.mark.anyio
async def test_chat_evaluation_classifies_claims_and_scores_default_rubric(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    messages = [
        chat_result_message("chat-claims", chat_claim_payload()),
        chat_result_message(
            "chat-rubric", relevance_completeness_payload(), total_cost_usd=0.002,
            usage={"input_tokens": 5, "output_tokens": 8},
        ),
    ]

    async def fake_query(*, prompt: str, options: object):
        assert "assistant_answer" in prompt
        yield messages.pop(0)

    monkeypatch.setattr(evaluator, "query", fake_query)

    body = chat_request(
        transcript=[
            {"role": "user", "content": "When does the migration launch, and who owns it?"},
            {
                "role": "assistant",
                "content": "The launch is on 2026-01-01 and is owned by the payments team.",
            },
        ],
        evidence=[{
            "id": "evidence-1",
            "canonical_uri": "https://example.test/evidence",
            "content_hash": "example-hash",
            "content": "Launch date is 2026-02-01. Owner: payments team.",
        }],
    )

    response = await evaluate_chat_transcript(body)

    assert [claim.classification for claim in response.claims] == ["contradicted", "supported"]
    assert all(claim.page == "transcript" for claim in response.claims)
    assert response.relevance_completeness.method == "rubric"
    assert response.relevance_completeness.relevance.score == 0.9
    assert response.relevance_completeness.completeness.score == 0.6
    assert response.relevance_completeness.rubric_applied == evaluator._DEFAULT_CHAT_RUBRIC
    assert response.tokens == {"input": 15, "output": 28}
    assert response.cost_usd == pytest.approx(0.012)
    assert response.turns == 2
    assert response.attempts == 2
    assert response.batches == 1


@pytest.mark.anyio
async def test_chat_evaluation_flags_fabricated_details(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    claim_payload = {
        "claims": [{
            "exact_text": "revenue grew 40% thanks to our new partner Acme Corp",
            "classification": "unsupported",
            "reason": "No partner or percentage appears in evidence.",
            "confidence": 0.85,
            "evidence": [],
            "critical_kind": "partner_or_customer",
            "fabricated_entities": ["Acme Corp"],
            "fabricated_quantitative_details": ["40%"],
        }],
    }
    messages = [
        chat_result_message("chat-fab-claims", claim_payload),
        chat_result_message("chat-fab-rubric", relevance_completeness_payload()),
    ]

    async def fake_query(*, prompt: str, options: object):
        yield messages.pop(0)

    monkeypatch.setattr(evaluator, "query", fake_query)

    body = chat_request(
        transcript=[{
            "role": "assistant",
            "content": "revenue grew 40% thanks to our new partner Acme Corp",
        }],
        evidence=[],
    )

    response = await evaluate_chat_transcript(body)

    assert response.claims[0].fabricated_entities == ["Acme Corp"]
    assert response.claims[0].fabricated_quantitative_details == ["40%"]
    assert response.claims[0].critical_kind == "partner_or_customer"


def close_match_payload() -> dict:
    return {
        "relevance": {"score": 0.95, "rationale": "Matches the reference closely.", "findings": []},
        "completeness": {"score": 0.9, "rationale": "Covers the same points as the reference.", "findings": []},
    }


def off_topic_payload() -> dict:
    return {
        "relevance": {
            "score": 0.1,
            "rationale": "Answers a different question than the reference addresses.",
            "findings": ["Reference discusses the migration deadline; answer discusses unrelated topic."],
        },
        "completeness": {
            "score": 0.1,
            "rationale": "Covers none of the reference's points.",
            "findings": ["Reference discusses the migration deadline; answer discusses unrelated topic."],
        },
    }


async def _evaluate_chat_with_rubric_and_reference_responses(
    monkeypatch: pytest.MonkeyPatch,
    *,
    rc_payload: dict,
    **request_overrides: object,
) -> ChatEvaluationResponse:
    messages = [
        chat_result_message("chat-claims", chat_claim_payload()),
        chat_result_message("chat-rc", rc_payload),
    ]

    async def fake_query(*, prompt: str, options: object):
        yield messages.pop(0)

    monkeypatch.setattr(evaluator, "query", fake_query)
    return await evaluate_chat_transcript(chat_request(**request_overrides))


@pytest.mark.anyio
async def test_chat_evaluation_scores_against_a_closely_matching_reference_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = await _evaluate_chat_with_rubric_and_reference_responses(
        monkeypatch,
        rc_payload=close_match_payload(),
        reference_answer="Example output",
    )

    assert response.relevance_completeness.method == "reference_answer"
    assert response.relevance_completeness.rubric_applied is None
    assert response.relevance_completeness.relevance.score == 0.95
    assert response.relevance_completeness.completeness.score == 0.9


@pytest.mark.anyio
async def test_chat_evaluation_scores_low_against_a_substantially_different_reference_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = await _evaluate_chat_with_rubric_and_reference_responses(
        monkeypatch,
        rc_payload=off_topic_payload(),
        reference_answer="A completely different answer about an unrelated topic.",
    )

    assert response.relevance_completeness.method == "reference_answer"
    assert response.relevance_completeness.relevance.score == 0.1
    assert response.relevance_completeness.completeness.score == 0.1
    assert response.relevance_completeness.completeness.findings


@pytest.mark.anyio
async def test_chat_evaluation_reference_answer_takes_precedence_over_rubric(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = await _evaluate_chat_with_rubric_and_reference_responses(
        monkeypatch,
        rc_payload=close_match_payload(),
        reference_answer="Example output",
        rubric=[{"id": "custom", "description": "Custom criterion that should be ignored."}],
    )

    assert response.relevance_completeness.method == "reference_answer"
    assert response.relevance_completeness.rubric_applied is None


@pytest.mark.anyio
async def test_chat_evaluation_applies_a_custom_rubric_when_supplied(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    custom_rubric = [
        {"id": "tone", "description": "Answer is written in a professional tone."},
    ]

    response = await _evaluate_chat_with_rubric_and_reference_responses(
        monkeypatch,
        rc_payload=close_match_payload(),
        rubric=custom_rubric,
    )

    assert response.relevance_completeness.method == "rubric"
    assert [c.id for c in response.relevance_completeness.rubric_applied] == ["tone"]
    assert response.relevance_completeness.rubric_applied != evaluator._DEFAULT_CHAT_RUBRIC


@pytest.mark.anyio
async def test_chat_evaluation_scores_low_relevance_for_off_topic_answer_under_default_rubric(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = await _evaluate_chat_with_rubric_and_reference_responses(
        monkeypatch,
        rc_payload=off_topic_payload(),
    )

    assert response.relevance_completeness.method == "rubric"
    assert response.relevance_completeness.rubric_applied == evaluator._DEFAULT_CHAT_RUBRIC
    assert response.relevance_completeness.relevance.score == 0.1
