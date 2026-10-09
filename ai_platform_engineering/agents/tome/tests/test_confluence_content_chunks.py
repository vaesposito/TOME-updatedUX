"""Large page reads stay inline, lossless, version-consistent, and scoped."""

import json
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest

from tome_agent.agent import mcp_confluence
from tome_agent.agent.connectors import base
from tome_agent.agent.connectors.base import SourceItem
from tome_agent.agent.connectors.confluence import ConfluenceConnector


def page_result(
    body: str, *, version: int = 3, space: str = "EXAMPLE"
) -> dict[str, Any]:
    return {
        "results": [
            {
                "lastModified": "2026-01-02T09:00:00Z",
                "content": {
                    "id": "123",
                    "title": "Example tracker",
                    "space": {"key": space},
                    "body": {"storage": {"value": body}},
                    "version": {"number": version},
                },
            }
        ],
    }


def tools_for(
    monkeypatch: pytest.MonkeyPatch,
    response: dict[str, Any],
    *,
    page_scoped: bool = False,
    read_state: mcp_confluence.ConfluenceReadState | None = None,
) -> tuple[dict[str, Any], list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=response)

    real_client = httpx.AsyncClient
    transport = httpx.MockTransport(handle)
    monkeypatch.setattr(
        mcp_confluence.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=transport, **kwargs),
    )
    monkeypatch.setattr(
        mcp_confluence, "create_sdk_mcp_server", lambda **kwargs: kwargs
    )
    server = mcp_confluence.build_confluence_mcp(
        read_state=read_state,
        token="example-token",
        cloud_id="example-cloud",
        site_url="https://example.test",
        allowed_space_keys=["EXAMPLE"],
        page_scoped_space_keys=["EXAMPLE"] if page_scoped else [],
        selected_root_page_ids=["123"] if page_scoped else [],
    )
    return {tool.name: tool for tool in server["tools"]}, requests


def payload(result: dict[str, Any]) -> dict[str, Any]:
    assert not result.get("is_error"), result
    text = result["content"][0]["text"]
    assert len(text.encode("utf-8")) <= 8_000
    return json.loads(text)


@pytest.mark.asyncio
@pytest.mark.parametrize("padding", ["x", '"\\\n\t', "漢字🙂"])
async def test_oversized_single_line_table_is_reconstructed_losslessly(
    monkeypatch: pytest.MonkeyPatch,
    padding: str,
) -> None:
    body = (
        "<table><tr><th>Item</th><th>Manual</th><th>Workflow</th></tr>"
        f"<tr><td>{padding * 80_000}</td><td>In Progress</td><td>Open</td></tr>"
        '<tr><td><a href="https://example.test/task/1">Final item</a></td>'
        '<td>Complete</td><td><ac:structured-macro ac:name="jira">'
        "In Progress</ac:structured-macro></td></tr></table>"
    )
    tools, requests = tools_for(monkeypatch, page_result(body))
    first = payload(
        await tools["confluence_get_page_content"].handler({"page_id": "123"})
    )
    assert first["truncated"] and first["next_offset"] > 0
    assert first["total_chars"] == len(body)
    assert first["version"] == 3
    assert first["url"] == "https://example.test/wiki/spaces/EXAMPLE/pages/123"
    chunks = [first["body"]]
    current = first
    while current["next_offset"] is not None:
        offset = current["next_offset"]
        current = payload(
            await tools["confluence_get_page_content_chunk"].handler(
                {
                    "page_id": "123",
                    "offset": offset,
                    "content_revision": first["content_revision"],
                    "limit": 6000,
                }
            )
        )
        assert current["offset"] == offset
        assert current["content_revision"] == first["content_revision"]
        assert current["body"]
        assert len(current["body"]) <= 6000
        if current["next_offset"] is not None:
            assert current["next_offset"] > offset
        chunks.append(current["body"])
    assert "".join(chunks) == body
    assert not current["truncated"]
    assert "Final item" in "".join(chunks)
    assert len(requests) == len(chunks)


@pytest.mark.asyncio
@pytest.mark.parametrize("body", ["", "<p>A short page.</p>"])
async def test_small_page_completes_without_continuation(
    monkeypatch: pytest.MonkeyPatch, body: str
) -> None:
    tools, requests = tools_for(monkeypatch, page_result(body))
    result = payload(
        await tools["confluence_get_page_content"].handler({"page_id": "123"})
    )
    assert result["body"] == body
    assert result["offset"] == 0
    assert result["total_chars"] == len(body)
    assert result["next_offset"] is None
    assert not result["truncated"]
    assert len(requests) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["body", "version", "title"])
async def test_changed_source_cannot_be_combined_with_previous_chunks(
    monkeypatch: pytest.MonkeyPatch,
    change: str,
) -> None:
    response = page_result("a" * 20_000)
    tools, _ = tools_for(monkeypatch, response)
    first = payload(
        await tools["confluence_get_page_content"].handler({"page_id": "123"})
    )
    content = response["results"][0]["content"]
    if change == "body":
        content["body"]["storage"]["value"] += "changed"
    elif change == "version":
        content["version"]["number"] += 1
    else:
        content["title"] = "Changed title"
    result = await tools["confluence_get_page_content_chunk"].handler(
        {
            "page_id": "123",
            "offset": first["next_offset"],
            "content_revision": first["content_revision"],
            "limit": 6000,
        }
    )
    assert result["is_error"]
    assert "revision changed" in result["content"][0]["text"]
    assert "a" * 20 not in json.dumps(result)


@pytest.mark.asyncio
@pytest.mark.parametrize("page_scoped", [False, True])
async def test_continuation_rechecks_project_scope(
    monkeypatch: pytest.MonkeyPatch, page_scoped: bool
) -> None:
    response = page_result("private body" * 1000)
    tools, _ = tools_for(monkeypatch, response, page_scoped=page_scoped)
    first = payload(
        await tools["confluence_get_page_content"].handler({"page_id": "123"})
    )
    content = response["results"][0]["content"]
    if page_scoped:
        content["id"] = "456"
    else:
        content["space"]["key"] = "SECONDARY"
    result = await tools["confluence_get_page_content_chunk"].handler(
        {
            "page_id": "456" if page_scoped else "123",
            "offset": first["next_offset"],
            "content_revision": first["content_revision"],
            "limit": 6000,
        }
    )
    assert result["is_error"]
    assert "private body" not in json.dumps(result)
    assert "scope" in json.dumps(result) or "outside the selected" in json.dumps(result)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "override",
    [
        {"offset": -1},
        {"offset": True},
        {"offset": "1"},
        {"offset": 1.5},
        {"limit": 0},
        {"limit": 6001},
        {"limit": True},
        {"limit": "1"},
        {"content_revision": ""},
        {"content_revision": "z" * 64},
        {"page_id": "123 or type=page"},
        {"page_id": "1" * 65},
    ],
)
async def test_invalid_continuation_does_not_fetch(
    monkeypatch: pytest.MonkeyPatch,
    override: dict[str, Any],
) -> None:
    tools, requests = tools_for(monkeypatch, page_result("body"))
    result = await tools["confluence_get_page_content_chunk"].handler(
        {
            "page_id": "123",
            "offset": 0,
            "limit": 6000,
            "content_revision": "a" * 64,
            **override,
        }
    )
    assert result["is_error"]
    assert not requests


@pytest.mark.asyncio
async def test_offset_past_end_is_rejected_and_exact_end_is_complete(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tools, _ = tools_for(monkeypatch, page_result("body"))
    first = payload(
        await tools["confluence_get_page_content"].handler({"page_id": "123"})
    )
    args = {"page_id": "123", "content_revision": first["content_revision"], "limit": 1}
    assert (
        await tools["confluence_get_page_content_chunk"].handler({**args, "offset": 5})
    )["is_error"]
    end = payload(
        await tools["confluence_get_page_content_chunk"].handler({**args, "offset": 4})
    )
    assert end["body"] == "" and end["next_offset"] is None


def test_oversized_metadata_returns_an_explicit_bounded_error() -> None:
    result = mcp_confluence._page_content_result(
        {"body": "body", "title": "x" * 20_000}
    )
    assert result["is_error"]
    assert len(result["content"][0]["text"].encode()) < 8_000


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [None, 12])
async def test_unreadable_body_is_not_reported_as_an_empty_complete_page(
    monkeypatch: pytest.MonkeyPatch,
    body: Any,
) -> None:
    response = page_result("body")
    response["results"][0]["content"]["body"]["storage"]["value"] = body
    tools, _ = tools_for(monkeypatch, response)
    result = await tools["confluence_get_page_content"].handler({"page_id": "123"})
    assert result["is_error"]
    assert "missing or invalid" in result["content"][0]["text"]


@pytest.mark.asyncio
async def test_chunk_fetch_ledger_retains_continuation_and_bounded_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    append = AsyncMock()
    monkeypatch.setattr(base.http_client, "get_active_run_id", lambda: "example-run")
    monkeypatch.setattr(base.http_client, "append_fetch_ledger_entry", append)
    tools, _ = tools_for(monkeypatch, page_result("body" * 10_000))
    first = payload(
        await tools["confluence_get_page_content"].handler({"page_id": "123"})
    )
    args = {
        "page_id": "123",
        "offset": first["next_offset"],
        "content_revision": first["content_revision"],
        "limit": 6000,
    }
    result = await tools["confluence_get_page_content_chunk"].handler(args)
    payload(result)
    assert append.await_count == 2
    run_id, entry = append.await_args.args
    assert run_id == "example-run"
    assert entry.status == "success"
    assert entry.tool_name == "confluence_get_page_content_chunk"
    assert entry.tool_args == args
    assert entry.canonical_uri == "confluence://pages/123"
    assert entry.content == result["content"][0]["text"]


def test_continuation_tool_and_instructions_are_available_to_ingest_and_chat() -> None:
    connector = ConfluenceConnector()
    sources = [
        SourceItem(
            slug="example", display_name="Example", extra={"space_key": "EXAMPLE"}
        )
    ]
    assert "mcp__confluence__confluence_get_page_content_chunk" in connector.mcp_tools
    for guidance in (
        connector.system_prompt_block(sources),
        connector.deep_research_guidance(sources),
    ):
        assert "confluence_get_page_content_chunk" in guidance
        assert "content_revision" in guidance
        assert "next_offset" in guidance


@pytest.mark.asyncio
async def test_native_read_coverage_requires_every_chunk_and_all_selected_roots(monkeypatch: pytest.MonkeyPatch) -> None:
    state = mcp_confluence.ConfluenceReadState(required_pages={"123", "456"})
    tools, _ = tools_for(monkeypatch, page_result("x" * 9000), read_state=state)
    first = payload(await tools["confluence_get_page_content"].handler({"page_id": "123"}))
    assert state.incomplete_pages() == ["123", "456"]
    payload(await tools["confluence_get_page_content_chunk"].handler({
        "page_id": "123", "offset": first["next_offset"], "content_revision": first["content_revision"], "limit": 6000,
    }))
    assert state.incomplete_pages() == ["456"]


def test_terminal_chunk_without_first_chunk_does_not_count_as_complete() -> None:
    state = mcp_confluence.ConfluenceReadState()
    state.record("123", mcp_confluence._page_content_result({"id": "123", "body": "x" * 9000}, offset=6000))
    assert state.incomplete_pages() == ["123"]


def test_gaps_and_failed_reads_require_restart() -> None:
    state = mcp_confluence.ConfluenceReadState()
    page = {"id": "123", "body": "x" * 9000}
    state.record("123", mcp_confluence._page_content_result(page, limit=3000))
    state.record("123", mcp_confluence._page_content_result(page, offset=6000))
    assert state.incomplete_pages() == ["123"]
    state.record("123", mcp_confluence._page_content_result(page, offset=3000, limit=3000))
    assert state.incomplete_pages() == []
    state.record("123", mcp_confluence._err("request failed"))
    assert state.incomplete_pages() == ["123"]
    state.record("123", mcp_confluence._page_content_result(page))
    state.record("123", mcp_confluence._page_content_result(page, offset=6000))
    assert state.incomplete_pages() == []
