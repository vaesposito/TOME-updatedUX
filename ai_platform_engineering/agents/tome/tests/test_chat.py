from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, Self

import pytest
from claude_agent_sdk import ClaudeAgentOptions, ResultMessage

from tome_agent.agent import chat
from tome_agent.agent.chat import _is_context_exhausted_result, _translate
from tome_agent.orchestrator.contract import ProjectSnapshot


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


@pytest.mark.asyncio
async def test_myagent_chat_exposes_the_tool_and_keeps_research_read_only(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("TTT_PROJECT_ROOT", str(tmp_path))
    monkeypatch.setattr(chat.http_client, "fetch_model_config", lambda *args: None)
    captured: dict[str, Any] = {}

    class Client:
        def __init__(self, options: ClaudeAgentOptions) -> None:
            captured["options"] = options

        async def __aenter__(self) -> Self:
            return self

        async def __aexit__(self, *args: object) -> bool:
            return False

        async def query(self, prompt: str) -> None:
            captured["prompt"] = prompt

        async def receive_response(self) -> AsyncIterator[ResultMessage]:
            yield ResultMessage(subtype="success", duration_ms=1, duration_api_ms=1, is_error=False,
                                num_turns=1, session_id="private-session", result="Email summary")

    monkeypatch.setattr(chat, "ClaudeSDKClient", Client)
    events = [event async for event in chat.stream_chat(
        user_message="Can you ask MyAgent for my emails?", sdk_session_id=None,
        snapshot=ProjectSnapshot(project_id="project-1", name="Example"), stable_pages={},
        myagent_research=True, myagent_run_id="chat-run-1", myagent_sources=["outlook"],
    )]
    options = captured["options"]
    assert "mcp__myagent__ask_myagent" in options.allowed_tools
    assert options.tools == ["Read", "Glob", "Grep"]
    assert set(options.mcp_servers) == {"myagent"}
    assert "separate native email tool is not required" in options.system_prompt
    assert "outlook" in options.system_prompt
    assert events
