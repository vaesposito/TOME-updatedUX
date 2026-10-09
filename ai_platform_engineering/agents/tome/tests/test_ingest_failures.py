"""Agent errors cannot advance a pass, reconcile pages, or count as success."""

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest

from tome_agent.agent import ingestor, main
from tome_agent.orchestrator.contract import (
    IngestEventPayload,
    IngestRequest,
    ProjectSnapshot,
)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [
    IngestEventPayload(type="error", data={"message": "startup failed"}),
    IngestEventPayload(type="done", data={"subtype": "error_max_turns", "is_error": True}),
])
async def test_failed_standard_pass_stops_before_research_and_reconcile(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, failure: IngestEventPayload,
) -> None:
    monkeypatch.setenv("TTT_PROJECT_ROOT", str(tmp_path))
    monkeypatch.setattr(ingestor.http_client, "fetch_page_templates", lambda: None)
    monkeypatch.setattr(ingestor.http_client, "fetch_model_config", lambda *args: None)
    monkeypatch.setattr(ingestor.http_client, "fetch_all_pages_sync", lambda *args: {})
    monkeypatch.setattr(ingestor, "resolve_connector_extras", AsyncMock(return_value={}))
    monkeypatch.setattr(ingestor, "write_verbatim_pages", AsyncMock(return_value=[]))
    reconcile = Mock(return_value={})
    monkeypatch.setattr(ingestor.report_schema, "reconcile_template_bindings", reconcile)
    monkeypatch.setattr(ingestor, "build_agent_options", lambda **kwargs: kwargs)
    calls: list[dict] = []

    async def consume(*args: Any, **kwargs: Any) -> AsyncIterator[IngestEventPayload]:
        calls.append(kwargs)
        yield failure

    monkeypatch.setattr(ingestor, "consume_agent_query", consume)
    events = [event async for event in ingestor.stream_ingest(
        run_id=uuid4(), report_id=uuid4(), seed=None, connector_data={},
        snapshot=ProjectSnapshot(
            project_id="project-example", name="Example",
            webex_rooms=[{"slug": "example-room", "name": "Example", "room_id": "room-example"}],
        ),
        is_greenfield=True, myagent_questions_enabled=True, myagent_sources=["outlook"],
    )]
    assert events[-1] == failure
    assert len(calls) == 1
    reconcile.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(("events", "expected_success"), [
    ([IngestEventPayload(type="error", data={"message": "startup failed"})], False),
    ([IngestEventPayload(type="done", data={"subtype": "error_max_turns"})], False),
    ([], False),
    ([IngestEventPayload(type="done", data={"subtype": "success"})], True),
    ([IngestEventPayload(type="done", data={"subtype": "success"}),
      IngestEventPayload(type="error", data={"message": "later pass failed"})], False),
])
async def test_ingest_metrics_require_successful_completion(
    monkeypatch: pytest.MonkeyPatch, events: list[IngestEventPayload], expected_success: bool,
) -> None:
    monkeypatch.setattr(main._state, "ready", True)
    monkeypatch.setattr(main, "_require_fresh_workspace", AsyncMock())
    monkeypatch.setattr(main.workspace, "refresh_project", AsyncMock(return_value=True))
    finished = Mock()
    monkeypatch.setattr(main, "run_started", lambda: 1.0)
    monkeypatch.setattr(main, "run_finished", finished)

    async def consume(**kwargs) -> AsyncIterator[IngestEventPayload]:
        for event in events:
            yield event

    monkeypatch.setattr(main, "stream_ingest", consume)
    response = await main.ingest_endpoint(IngestRequest(
        run_id=uuid4(), report_id=uuid4(), snapshot=ProjectSnapshot(project_id="project-example", name="Example"),
        is_greenfield=False,
    ))
    chunks = [chunk async for chunk in response.body_iterator]
    assert len(chunks) == len(events)
    finished.assert_called_once_with("ingest", 1.0, expected_success)


@pytest.mark.asyncio
@pytest.mark.parametrize("complete", [False, True])
async def test_incomplete_confluence_read_cannot_emit_success(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, complete: bool,
) -> None:
    monkeypatch.setenv("TTT_PROJECT_ROOT", str(tmp_path))
    monkeypatch.setattr(ingestor.http_client, "fetch_page_templates", lambda: None)
    monkeypatch.setattr(ingestor.http_client, "fetch_model_config", lambda *args: None)
    monkeypatch.setattr(ingestor.http_client, "fetch_all_pages_sync", lambda *args: {})
    monkeypatch.setattr(ingestor, "resolve_connector_extras", AsyncMock(return_value={}))
    monkeypatch.setattr(ingestor, "write_verbatim_pages", AsyncMock(return_value=[]))
    reconcile = Mock(return_value={})
    monkeypatch.setattr(ingestor.report_schema, "reconcile_template_bindings", reconcile)

    def options(**kwargs: Any) -> dict[str, Any]:
        state = kwargs["confluence_read_state"]
        state.required_pages.add("123")
        state.record("123", {
            "content": [{"text": '{"offset":0,"body":"read","total_chars":4,"content_revision":"example"}'}],
        } if complete else {"is_error": True})
        return kwargs

    monkeypatch.setattr(ingestor, "build_agent_options", options)

    async def consume(*args: Any, **kwargs: Any) -> AsyncIterator[IngestEventPayload]:
        yield IngestEventPayload(type="done", data={"subtype": "success", "is_error": False})

    monkeypatch.setattr(ingestor, "consume_agent_query", consume)
    events = [event async for event in ingestor.stream_ingest(
        run_id=uuid4(), report_id=uuid4(), seed=None, connector_data={},
        snapshot=ProjectSnapshot(project_id="project-example", name="Example"),
        is_greenfield=True,
    )]
    if complete:
        assert any(event.type == "done" for event in events)
    else:
        assert not any(event.type == "done" for event in events)
        assert events[-1].data["code"] == "incomplete_source_read"
        reconcile.assert_not_called()
