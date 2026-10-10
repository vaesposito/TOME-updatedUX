from typing import Any
from unittest.mock import AsyncMock

import pytest

from tome_agent.agent import http_client
from tome_agent.agent.live_verification import LiveVerification


def chunk(offset: int) -> dict[str, Any]:
    return {
        "status": "read",
        "body": "x" * 24_000,
        "offset": offset,
        "total_chars": 72_000,
        "content_revision": "example-revision",
        "next_offset": offset + 24_000 if offset < 48_000 else None,
        "url": "https://example.test/wiki/pages/123",
    }


@pytest.mark.asyncio
async def test_completion_resumes_the_existing_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    fetch = AsyncMock(side_effect=[chunk(0), chunk(24_000), chunk(48_000)])
    monkeypatch.setattr(http_client, "fetch_retrieval", fetch)
    live = LiveVerification("test-user", "example-scope", "required", {"example"}, "example-grant")
    arguments = {"project_slug": "example", "url": "https://example.test/wiki/pages/123"}
    await live.read("read_confluence_page", {**arguments, "offset": 0})
    await live.read("read_confluence_page", {**arguments, "offset": 24_000, "content_revision": "example-revision"})

    await live.complete_page("example", arguments["url"])

    assert [call.args[3]["offset"] for call in fetch.call_args_list] == [0, 24_000, 48_000]
    assert live.characters == 72_000
    assert live.complete_evidence()[0]["body"] == "x" * 72_000
    assert live.complete_evidence()[0]["offset"] == 0
    assert live.complete_evidence()[0]["next_offset"] is None
    assert live.complete_evidence()[0]["read_coverage"] == "complete"
    assert not live.failures


@pytest.mark.asyncio
async def test_repeat_reads_recheck_scope_without_resetting_coverage(monkeypatch: pytest.MonkeyPatch) -> None:
    fetch = AsyncMock(side_effect=[chunk(0), chunk(24_000), {"status": "ok"}, chunk(48_000)])
    monkeypatch.setattr(http_client, "fetch_retrieval", fetch)
    live = LiveVerification("test-user", "example-scope", "required", {"example"}, "example-grant")
    arguments = {"project_slug": "example", "url": "https://example.test/wiki/pages/123"}
    await live.read("read_confluence_page", {**arguments, "offset": 0})
    await live.read("read_confluence_page", {**arguments, "offset": 24_000, "content_revision": "example-revision"})
    await live.read("read_confluence_page", {**arguments, "offset": 0})
    await live.complete_page("example", arguments["url"])

    assert fetch.call_args_list[2].args[2] == "scope"
    assert live.characters == 72_000
    assert live.calls == 3
    assert not live.state.incomplete_pages()
    assert len(live.complete_evidence()) == 1


@pytest.mark.asyncio
async def test_completion_fetches_a_missing_intermediate_chunk(monkeypatch: pytest.MonkeyPatch) -> None:
    fetch = AsyncMock(side_effect=[chunk(0), chunk(48_000), chunk(24_000)])
    monkeypatch.setattr(http_client, "fetch_retrieval", fetch)
    live = LiveVerification("test-user", "example-scope", "required", {"example"}, "example-grant")
    arguments = {"project_slug": "example", "url": "https://example.test/wiki/pages/123"}
    await live.read("read_confluence_page", {**arguments, "offset": 0})
    await live.read("read_confluence_page", {**arguments, "offset": 48_000, "content_revision": "example-revision"})
    await live.complete_page("example", arguments["url"])

    assert fetch.call_args_list[-1].args[3]["offset"] == 24_000
    assert len(live.complete_evidence()) == 1
