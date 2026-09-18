"""The model can supply a question, not a different user, project or run."""
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest

from tome_agent.agent import ingestor, mcp_myagent
from tome_agent.agent.loop import WIKI_TOOLS, build_agent_options
from tome_agent.orchestrator.contract import ProjectSnapshot


def make_tool(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(mcp_myagent, "create_sdk_mcp_server", lambda **kwargs: kwargs)
    return mcp_myagent.build_myagent_mcp("project-1", "run-1")["tools"][0]


@pytest.mark.asyncio
async def test_tool_uses_bound_identity_and_returns_untrusted_evidence(monkeypatch: pytest.MonkeyPatch) -> None:
    callback = AsyncMock(return_value={"status": "received", "content": "A cited finding."})
    monkeypatch.setattr(mcp_myagent.http_client, "ask_myagent", callback)
    tool = make_tool(monkeypatch)
    result = await tool.handler({"question": " Who owns the blocker? ", "run_id": "other-run", "project_id": "other-project"})
    callback.assert_awaited_once_with("project-1", "run-1", "Who owns the blocker?")
    assert "Untrusted research result" in result["content"][0]["text"]


@pytest.mark.asyncio
@pytest.mark.parametrize("question", ["", " ", "x" * 2001, None])
async def test_tool_rejects_invalid_questions_without_a_callback(monkeypatch: pytest.MonkeyPatch, question: Any) -> None:
    callback = AsyncMock()
    monkeypatch.setattr(mcp_myagent.http_client, "ask_myagent", callback)
    result = await make_tool(monkeypatch).handler({"question": question})
    assert result["is_error"]
    callback.assert_not_awaited()


@pytest.mark.asyncio
async def test_http_failure_does_not_leak_headers_or_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    request = httpx.Request("POST", "http://backend.example.com", headers={"Authorization": "Bearer private-token"})
    callback = AsyncMock(side_effect=httpx.HTTPStatusError("private-token", request=request, response=httpx.Response(429, request=request)))
    monkeypatch.setattr(mcp_myagent.http_client, "ask_myagent", callback)
    result = await make_tool(monkeypatch).handler({"question": "Who owns the blocker?"})
    assert result["is_error"]
    assert "private-token" not in str(result)
    callback.assert_awaited_once()


def test_tool_is_available_only_in_authorized_restricted_ingest(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("TTT_PROJECT_ROOT", str(tmp_path))
    monkeypatch.setenv("TTT_AGENT_ROLE", "editor")
    options = build_agent_options(
        snapshot=ProjectSnapshot(project_id="project-1", name="Example"),
        system_prompt="research", model="example-model", max_turns=3,
        persist_author="tester", restrict_untrusted_evidence=True, myagent_run_id="run-1",
    )
    assert options.tools == WIKI_TOOLS
    assert options.allowed_tools == [*WIKI_TOOLS, "mcp__myagent__ask_myagent"]
    assert set(options.mcp_servers) == {"myagent"}
    assert options.setting_sources == []
    assert options.skills == []

    for extra in ({"offline": True}, {"restrict_untrusted_evidence": False}):
        options = build_agent_options(**{
            "snapshot": ProjectSnapshot(project_id="project-1", name="Example"),
            "system_prompt": "test", "model": "example-model", "max_turns": 1,
            "persist_author": "tester", "restrict_untrusted_evidence": True,
            "myagent_run_id": "run-1", **extra,
        })
        assert "myagent" not in options.mcp_servers

    monkeypatch.setenv("TTT_AGENT_ROLE", "viewer")
    options = build_agent_options(
        snapshot=ProjectSnapshot(project_id="project-1", name="Example"),
        system_prompt="test", model="example-model", max_turns=1, persist_author="tester",
        restrict_untrusted_evidence=True, myagent_run_id="run-1",
    )
    assert "myagent" not in options.mcp_servers


@pytest.mark.asyncio
async def test_ingest_research_pass_gets_the_user_focus_and_bound_tool(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("TTT_PROJECT_ROOT", str(tmp_path))
    monkeypatch.setattr(ingestor.http_client, "fetch_page_templates", lambda: None)
    monkeypatch.setattr(ingestor.http_client, "fetch_model_config", lambda *args: None)
    monkeypatch.setattr(ingestor.http_client, "fetch_all_pages_sync", lambda *args: {})
    monkeypatch.setattr(ingestor, "resolve_connector_extras", AsyncMock(return_value={}))
    monkeypatch.setattr(ingestor, "write_verbatim_pages", AsyncMock(return_value=[]))
    monkeypatch.setattr(ingestor.report_schema, "reconcile_template_bindings", lambda *args: {})
    monkeypatch.setattr(ingestor, "build_agent_options", lambda **kwargs: kwargs)
    calls = []

    async def consume(prompt, options, log_buf, **kwargs):
        calls.append({"prompt": prompt, "options": options, **kwargs})
        if False:
            yield None

    monkeypatch.setattr(ingestor, "consume_agent_query", consume)
    run_id = uuid4()
    events = [event async for event in ingestor.stream_ingest(
        run_id=run_id, report_id=uuid4(), seed="Find the owner of the launch blocker.",
        connector_data={}, snapshot=ProjectSnapshot(project_id="project-1", name="Example", charter="Launch readiness"),
        is_greenfield=True, myagent_questions_enabled=True, myagent_sources=["outlook"],
    )]
    assert len(calls) == 1
    call = calls[0]
    assert call["options"]["myagent_run_id"] == str(run_id)
    assert call["options"]["restrict_untrusted_evidence"] is True
    assert "outlook" in call["options"]["system_prompt"]
    assert "Find the owner of the launch blocker." in call["prompt"]
    assert "Launch readiness" in call["options"]["system_prompt"]
    assert call["redact_sensitive_content"] is True
    assert events
