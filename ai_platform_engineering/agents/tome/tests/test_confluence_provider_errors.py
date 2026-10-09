"""Transient provider errors recover; authentication and invalid bodies stay failures."""

from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest

from tome_agent.agent import mcp_confluence
from tome_agent.agent.confluence_reads import ConfluenceReadState


@pytest.mark.asyncio
@pytest.mark.parametrize(("statuses", "expected_error"), [
    ([502, 200], False), ([503, 503, 503], True), ([401], True), ([403], True),
])
async def test_safe_read_retries_and_coverage(
    monkeypatch: pytest.MonkeyPatch, statuses: list[int], expected_error: bool,
) -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        status = statuses[len(requests) - 1]
        if status != 200:
            return httpx.Response(status, text="provider failure", headers={"Retry-After": "invalid"})
        return httpx.Response(200, json={"results": [{"content": {
            "id": "123", "title": "Example", "space": {"key": "EXAMPLE"},
            "body": {"storage": {"value": "<p>Full body</p>"}},
        }}]})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(mcp_confluence.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handle), **kwargs))
    monkeypatch.setattr(mcp_confluence.asyncio, "sleep", AsyncMock())
    monkeypatch.setattr(mcp_confluence, "create_sdk_mcp_server", lambda **kwargs: kwargs)
    state = ConfluenceReadState(required_pages={"123"})
    server = mcp_confluence.build_confluence_mcp(token="example-token", cloud_id="example-cloud", allowed_space_keys=["EXAMPLE"], read_state=state)
    tools: dict[str, Any] = {tool.name: tool for tool in server["tools"]}
    result = await tools["confluence_get_page_content"].handler({"page_id": "123"})
    assert bool(result.get("is_error")) is expected_error
    assert bool(state.incomplete_pages()) is expected_error
    assert len(requests) == len(statuses)
    if expected_error:
        assert "source content was not read" in result["content"][0]["text"]
        assert "provider failure" not in result["content"][0]["text"]


@pytest.mark.asyncio
async def test_discovery_error_cannot_be_hidden_by_unrelated_body_success(monkeypatch: pytest.MonkeyPatch) -> None:
    real_client = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(401, json={"error": "unauthorized"}))
    monkeypatch.setattr(mcp_confluence.httpx, "AsyncClient", lambda **kwargs: real_client(transport=transport, **kwargs))
    monkeypatch.setattr(mcp_confluence, "create_sdk_mcp_server", lambda **kwargs: kwargs)
    state = ConfluenceReadState()
    server = mcp_confluence.build_confluence_mcp(token="example-token", cloud_id="example-cloud", allowed_space_keys=["EXAMPLE"], read_state=state)
    tools = {tool.name: tool for tool in server["tools"]}
    result = await tools["confluence_get_pages"].handler({"space_key": "EXAMPLE", "limit": 1})
    assert result["is_error"]
    state.record("123", mcp_confluence._page_content_result({"id": "123", "body": "complete"}))
    assert len(state.incomplete_pages()) == 1
    assert state.incomplete_pages()[0].startswith("confluence_get_pages:")
