import asyncio
from typing import Any

import httpx
import pytest

from tome_agent.agent import http_client, mcp_webex
from tome_agent.agent.connectors.webex import WebexConnector


@pytest.fixture
def harness(monkeypatch: pytest.MonkeyPatch) -> tuple[dict[str, Any], list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        path = request.url.path
        if path.endswith("/messages"):
            room = request.url.params["roomId"]
            return httpx.Response(200, json={"items": [{"id": f"message-{room}", "roomId": room,
                "personId": f"person-{room}", "text": "Example message"}]})
        if "/messages/" in path:
            room = path.rsplit("message-", 1)[1]
            return httpx.Response(200, json={"id": f"message-{room}", "roomId": room,
                "personId": f"person-{room}", "text": "Example message"})
        if path.endswith("/people"):
            return httpx.Response(200, json={"items": []})
        if "/people/" in path:
            return httpx.Response(200, json={"id": path.rsplit("/", 1)[1], "displayName": "Example User"})
        if "/rooms/" in path:
            return httpx.Response(200, json={"id": path.rsplit("/", 1)[1], "title": "Example Room"})
        return httpx.Response(200, json={"items": []})

    original_client = httpx.AsyncClient

    def client(**kwargs: Any) -> httpx.AsyncClient:
        return original_client(transport=httpx.MockTransport(respond), **kwargs)

    monkeypatch.setattr(mcp_webex.httpx, "AsyncClient", client)
    monkeypatch.setattr(mcp_webex, "create_sdk_mcp_server", lambda **kwargs: {tool.name: tool.handler for tool in kwargs["tools"]})
    tools = mcp_webex.build_webex_mcp(token="caller-token", allowed_room_ids=["personal", "managed"],
        room_tokens={"personal": "caller-token", "managed": "generic-token", "outside": "must-not-use"})
    return tools, requests


def test_mixed_rooms_use_only_their_respective_tokens(harness: tuple[dict[str, Any], list[httpx.Request]]) -> None:
    tools, requests = harness

    async def run() -> None:
        for room in ["personal", "managed"]:
            await tools["webex_list_messages"]({"roomId": room})
            await tools["webex_get_message"]({"messageId": f"message-{room}"})
            await tools["webex_get_person"]({"personId": f"person-{room}"})

    asyncio.run(run())
    for request in requests:
        room = request.url.params.get("roomId") or request.url.params.get("id") or request.url.path
        expected = "generic-token" if "managed" in room else "caller-token"
        assert request.headers["Authorization"] == f"Bearer {expected}"


def test_rejects_outside_room_and_unseen_ids_without_using_any_token(harness: tuple[dict[str, Any], list[httpx.Request]]) -> None:
    tools, requests = harness

    async def run() -> None:
        for name, args in [
            ("webex_list_messages", {"roomId": "outside"}),
            ("webex_get_message", {"messageId": "guessed-message"}),
            ("webex_get_person", {"personId": "guessed-person"}),
        ]:
            assert (await tools[name](args))["is_error"] is True

    asyncio.run(run())
    assert requests == []


def test_meeting_tools_never_use_generic_room_token(harness: tuple[dict[str, Any], list[httpx.Request]]) -> None:
    tools, requests = harness
    asyncio.run(tools["webex_meetings_list_transcripts"]({"meetingId": "example-meeting"}))
    assert len(requests) == 1
    assert requests[0].headers["Authorization"] == "Bearer caller-token"


def test_managed_room_works_without_caller_token(harness: tuple[dict[str, Any], list[httpx.Request]]) -> None:
    _, requests = harness
    tools = mcp_webex.build_webex_mcp(allowed_room_ids=["managed"], room_tokens={"managed": "generic-token"})
    result = asyncio.run(tools["webex_list_messages"]({"roomId": "managed"}))
    assert not result.get("is_error")
    assert all(request.headers["Authorization"] == "Bearer generic-token" for request in requests)
    requests.clear()
    result = asyncio.run(tools["webex_meetings_list_transcripts"]({"meetingId": "example-meeting"}))
    assert result["is_error"] is True
    assert requests == []


def test_missing_room_mapping_never_falls_back_to_caller(harness: tuple[dict[str, Any], list[httpx.Request]]) -> None:
    _, requests = harness
    tools = mcp_webex.build_webex_mcp(token="caller-token", allowed_room_ids=["managed"], room_tokens={})
    assert asyncio.run(tools["webex_list_messages"]({"roomId": "managed"}))["is_error"] is True
    assert requests == []


def test_malformed_room_token_mapping_fails_closed() -> None:
    try:
        for value in ["not-json", "[]", "null"]:
            http_client.set_active_credentials({"webex": {"access_token": "caller-token", "room_tokens": value}})
            assert WebexConnector._room_tokens() == {}
    finally:
        http_client.set_active_credentials({})
