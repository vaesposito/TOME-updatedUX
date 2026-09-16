from __future__ import annotations

import pytest
from claude_agent_sdk import ResultMessage

from tome_agent.agent.chat import _is_context_exhausted_result, _translate


@pytest.mark.anyio
async def test_context_exhausted_result_is_not_translated_as_done() -> None:
    result = ResultMessage(
        subtype="success", duration_ms=1, duration_api_ms=1, is_error=True,
        num_turns=1, session_id="session-exhausted", result=None,
    )

    assert _is_context_exhausted_result(result)
    events = [
        event
        async for event in _translate(
            result, "example-model", {"model": "example-model", "source": "test", "scope_id": None}
        )
    ]

    assert [(event.type, event.data.get("code")) for event in events] == [
        ("error", "session_context_exhausted")
    ]


def test_nonempty_or_nonerror_result_is_not_context_exhaustion() -> None:
    assert not _is_context_exhausted_result(
        ResultMessage(
            subtype="success", duration_ms=1, duration_api_ms=1, is_error=False,
            num_turns=1, session_id="session-ok", result="A real answer",
        )
    )
