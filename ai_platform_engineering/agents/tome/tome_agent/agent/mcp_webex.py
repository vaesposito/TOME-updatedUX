"""In-process MCP server exposing the Webex REST API to the agents.

Follows the same pattern as mcp_github.py: in-process, no subprocess, no Docker.

Tools returned by `build_webex_mcp(token)`:
  webex_list_rooms(max?)
  webex_list_messages(roomId, max?)
  webex_get_message(messageId)
  webex_get_person(personId)
  webex_meetings_list_meetings(meetingType?, state?, from?, to?, max?, hostEmail?, meetingNumber?)
  webex_meetings_list_transcripts(meetingId?, hostEmail?, from?, to?, max?)
  webex_meetings_get_summary(meetingId)
"""

from __future__ import annotations

import asyncio
import json
from functools import partial
from typing import Any
from urllib.parse import quote

import httpx
from claude_agent_sdk import create_sdk_mcp_server, tool

from tome_agent.agent.connectors.base import record_fetch

API = "https://webexapis.com/v1"
DEFAULT_MAX = 50

# No current tool takes a free-text argument — hostEmail/meetingType/state
# etc. are structural, not prose — but the allowlist is explicit so a future
# free-text argument (e.g. a message-search query) is redacted by default.
_WEBEX_ALLOWED_ARGS = frozenset(
    {
        "roomId", "messageId", "personId", "meetingId", "hostEmail",
        "meetingType", "state", "from", "to", "max", "meetingNumber",
    }
)


def _webex_canonical_uri(tool_name: str, args: dict[str, Any]) -> str:
    if args.get("roomId"):
        return f"webex://rooms/{args['roomId']}"
    if args.get("messageId"):
        return f"webex://messages/{args['messageId']}"
    if args.get("personId"):
        return f"webex://people/{args['personId']}"
    if args.get("meetingId"):
        return f"webex://meetings/{args['meetingId']}"
    return f"webex://{tool_name.removeprefix('webex_')}"


_record_fetch = partial(
    record_fetch,
    connector="webex",
    allowed_arg_keys=_WEBEX_ALLOWED_ARGS,
    canonical_uri=_webex_canonical_uri,
)


def _ok(payload: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}]}


def _err(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "is_error": True}


def build_webex_mcp(
    token: str = "",
    allowed_room_ids: list[str] | None = None,
    *,
    messaging_only: bool = False,
    room_tokens: dict[str, str] | None = None,
):
    """Create the MCP server for Webex API calls.

    `allowed_room_ids` is the project's attached-room allowlist. Room-scoped
    tools refuse any roomId outside it (mirrors the GitHub MCP's repo
    allowlist), so the agent can only read the rooms this project declares —
    not every room the user's token can reach. An empty/None allowlist means
    no rooms are in scope and every room-scoped call is refused.
    """
    allowed: set[str] = {r for r in (allowed_room_ids or []) if r}
    # These tokens are never used for meeting APIs or arbitrary person/message
    # lookups. Resolve IDs only after seeing them in an allowed room's messages.
    message_rooms: dict[str, str] = {}
    person_rooms: dict[str, str] = {}

    def _room_token(room_id: str) -> str:
        if room_id not in allowed:
            return ""
        return room_tokens.get(room_id, "") if room_tokens is not None else token

    def _in_scope(room_id: str) -> bool:
        return room_id in allowed

    def _headers(access_token: str) -> dict[str, str]:
        h = {"Content-Type": "application/json", "User-Agent": "ttt-ingest-agent"}
        if access_token:
            h["Authorization"] = f"Bearer {access_token}"
        return h

    async def _get(path: str, params: dict[str, Any] | None = None, *, access_token: str | None = None) -> Any:
        async with httpx.AsyncClient(timeout=20.0, headers=_headers(token if access_token is None else access_token)) as client:
            for attempt in range(3):
                resp = await client.get(f"{API}{path}", params=params)
                if resp.status_code != 429 or attempt == 2:
                    resp.raise_for_status()
                    return resp.json()
                wait = int(resp.headers.get("Retry-After", "5"))
                await asyncio.sleep(min(wait, 60))

    # Per-server display-name cache for message authors. Webex `/messages` only
    # returns personId/personEmail (no name), so the agent would otherwise have
    # to guess a name from the email local-part — which it does, badly. We
    # resolve real names via the bulk `/people?id=...` endpoint (≤85 ids/call)
    # and cache them for the life of this MCP server (one ingest/chat run).
    _person_names_by_room: dict[str, dict[str, str]] = {}

    async def _resolve_person_names(person_ids: list[str], room_id: str) -> dict[str, str]:
        _person_names = _person_names_by_room.setdefault(room_id, {})
        unknown = [pid for pid in dict.fromkeys(person_ids) if pid and pid not in _person_names]
        for i in range(0, len(unknown), 85):
            batch = unknown[i : i + 85]
            try:
                data = await _get("/people", {"id": ",".join(batch)}, access_token=_room_token(room_id))
            except httpx.HTTPStatusError:
                continue
            for p in data.get("items") or []:
                pid = p.get("id")
                if pid:
                    _person_names[pid] = p.get("displayName") or (p.get("emails") or [""])[0] or ""
        return _person_names

    @tool(
        "webex_list_rooms",
        "List the Webex rooms attached to THIS project (scoped). Returns newest-first.",
        {"max": int},
    )
    @_record_fetch(tool_name="webex_list_rooms")
    async def list_rooms(args: dict) -> dict[str, Any]:
        if not allowed:
            return _ok([])  # no Webex rooms attached to this project
        # Fetch each attached room by ID instead of listing /rooms and filtering.
        # A user can be in hundreds of rooms, and a recency-sorted /rooms page
        # (max=N) can omit an attached-but-not-recently-active room entirely, so
        # the old list-then-filter approach returned [] even when the room was
        # attached. GET /rooms/{id} always resolves a room the token can see;
        # skip any that error (e.g. 404 when the token is not a member).
        out: list[dict[str, Any]] = []
        for rid in allowed:
            room_token = _room_token(rid)
            if not room_token:
                continue
            try:
                r = await _get(f"/rooms/{quote(rid, safe='')}", access_token=room_token)
            except httpx.HTTPStatusError:
                continue
            out.append(
                {
                    "id": r.get("id"),
                    "title": r.get("title"),
                    "type": r.get("type"),
                    "created": r.get("created"),
                    "lastActivity": r.get("lastActivity"),
                    "isLocked": r.get("isLocked"),
                }
            )
        return _ok(out)

    @tool(
        "webex_list_messages",
        "List messages in a Webex room (newest first). `roomId` is required.",
        {"roomId": str, "max": int},
    )
    @_record_fetch(tool_name="webex_list_messages")
    async def list_messages(args: dict) -> dict[str, Any]:
        room_id = args.get("roomId") or ""
        if not room_id:
            return _err("roomId is required")
        if not _in_scope(room_id):
            return _err(
                f"roomId {room_id!r} is not attached to this project. "
                f"Only this project's rooms are in scope."
            )
        room_token = _room_token(room_id)
        if not room_token:
            return _err("This space has no execution credential configured")
        params = {
            "roomId": room_id,
            "max": args.get("max") or DEFAULT_MAX,
            "sortBy": "created",
            "dir": "desc",
        }
        try:
            data = await _get("/messages", params, access_token=room_token)
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        items = data.get("items") or []
        items = [m for m in items if m.get("roomId") == room_id]
        for message in items:
            if message.get("id"):
                message_rooms[message["id"]] = room_id
            if message.get("personId"):
                person_rooms[message["personId"]] = room_id
        names = await _resolve_person_names([m.get("personId") or "" for m in items], room_id)
        out = [
            {
                "id": m.get("id"),
                "roomId": m.get("roomId"),
                "personId": m.get("personId"),
                "personEmail": m.get("personEmail"),
                "personName": names.get(m.get("personId") or "") or m.get("personEmail"),
                "text": m.get("text"),
                "created": m.get("created"),
            }
            for m in items
        ]
        return _ok(out)

    @tool(
        "webex_get_message",
        "Get a specific Webex message. `messageId` is required.",
        {"messageId": str},
    )
    @_record_fetch(tool_name="webex_get_message")
    async def get_message(args: dict) -> dict[str, Any]:
        message_id = args.get("messageId") or ""
        if not message_id:
            return _err("messageId is required")
        room_id = message_rooms.get(message_id, "")
        if room_tokens is not None and not room_id:
            return _err("List this project's room messages first; this message is not in the scoped results")
        access_token = _room_token(room_id) if room_tokens is not None else token
        if not access_token:
            return _err("This message has no execution credential configured")
        try:
            data = await _get(f"/messages/{quote(message_id, safe='')}", access_token=access_token)
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        # A messageId isn't room-scoped on its own; enforce scope on the
        # message's own room before returning any content.
        if not _in_scope(data.get("roomId") or "") or (room_tokens is not None and data.get("roomId") != room_id):
            return _err(
                f"message {message_id!r} belongs to a room not attached to this "
                f"project; out of scope."
            )
        pid = data.get("personId") or ""
        room_id = data["roomId"]
        if pid:
            person_rooms[pid] = room_id
        names = await _resolve_person_names([pid], room_id)
        out = {
            "id": data.get("id"),
            "roomId": data.get("roomId"),
            "personId": data.get("personId"),
            "personEmail": data.get("personEmail"),
            "personName": names.get(pid) or data.get("personEmail"),
            "text": data.get("text"),
            "created": data.get("created"),
            "files": data.get("files"),
        }
        return _ok(out)

    @tool(
        "webex_get_person",
        "Get Webex person details (cached). `personId` is required.",
        {"personId": str},
    )
    @_record_fetch(tool_name="webex_get_person")
    async def get_person(args: dict) -> dict[str, Any]:
        person_id = args.get("personId") or ""
        if not person_id:
            return _err("personId is required")
        room_id = person_rooms.get(person_id, "")
        if room_tokens is not None and not room_id:
            return _err("List this project's room messages first; this person is not in the scoped results")
        access_token = _room_token(room_id) if room_tokens is not None else token
        if not access_token:
            return _err("This person has no execution credential configured")
        try:
            data = await _get(f"/people/{quote(person_id, safe='')}", access_token=access_token)
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = {
            "id": data.get("id"),
            "emails": data.get("emails"),
            "displayName": data.get("displayName"),
            "nickName": data.get("nickName"),
            "firstName": data.get("firstName"),
            "lastName": data.get("lastName"),
            "avatar": data.get("avatar"),
            "orgId": data.get("orgId"),
            "created": data.get("created"),
            "timezone": data.get("timezone"),
            "lastActivity": data.get("lastActivity"),
            "status": data.get("status"),
        }
        return _ok(out)

    @tool(
        "webex_meetings_list_meetings",
        "List Webex meetings. All params optional. `meetingType`: meetingSeries|scheduledMeeting|meeting. `state`: active|scheduled|ready|lobby|ended|missed|expired. `from`/`to` are ISO8601 timestamps.",
        {"meetingType": str, "state": str, "from": str, "to": str, "max": int, "hostEmail": str, "meetingNumber": str},
    )
    @_record_fetch(tool_name="webex_meetings_list_meetings")
    async def list_meetings(args: dict) -> dict[str, Any]:
        if not token:
            return _err("webex_token is not configured")
        params: dict[str, Any] = {}
        if args.get("meetingType"):
            params["meetingType"] = args["meetingType"]
        if args.get("state"):
            params["state"] = args["state"]
        if args.get("from"):
            params["from"] = args["from"]
        if args.get("to"):
            params["to"] = args["to"]
        params["max"] = args.get("max") or DEFAULT_MAX
        if args.get("hostEmail"):
            params["hostEmail"] = args["hostEmail"]
        if args.get("meetingNumber"):
            params["meetingNumber"] = args["meetingNumber"]
        try:
            data = await _get("/meetings", params)
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        items = data.get("items") or []
        out = [
            {
                "id": m.get("id"),
                "title": m.get("title"),
                "meetingNumber": m.get("meetingNumber"),
                "start": m.get("start"),
                "end": m.get("end"),
                "hostDisplayName": m.get("hostDisplayName"),
                "hostEmail": m.get("hostEmail"),
                "meetingType": m.get("meetingType"),
                "state": m.get("state"),
                "timezone": m.get("timezone"),
            }
            for m in items
        ]
        return _ok(out)

    @tool(
        "webex_meetings_list_transcripts",
        "List Webex meeting transcripts. All params optional. Provide `meetingId` to filter to a specific meeting. `from`/`to` are ISO8601 timestamps.",
        {"meetingId": str, "hostEmail": str, "from": str, "to": str, "max": int},
    )
    @_record_fetch(tool_name="webex_meetings_list_transcripts")
    async def list_transcripts(args: dict) -> dict[str, Any]:
        if not token:
            return _err("webex_token is not configured")
        params: dict[str, Any] = {}
        if args.get("meetingId"):
            params["meetingId"] = args["meetingId"]
        if args.get("hostEmail"):
            params["hostEmail"] = args["hostEmail"]
        if args.get("from"):
            params["from"] = args["from"]
        if args.get("to"):
            params["to"] = args["to"]
        params["max"] = args.get("max") or DEFAULT_MAX
        try:
            data = await _get("/meetingTranscripts", params)
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        items = data.get("items") or []
        out = [
            {
                "id": t.get("id"),
                "meetingId": t.get("meetingId"),
                "title": t.get("title"),
                "createTime": t.get("createTime"),
                "downloadUrl": t.get("downloadUrl"),
            }
            for t in items
        ]
        return _ok(out)

    @tool(
        "webex_meetings_get_summary",
        "Get the AI-generated summary for a specific Webex meeting. `meetingId` is required.",
        {"meetingId": str},
    )
    @_record_fetch(tool_name="webex_meetings_get_summary")
    async def get_summary(args: dict) -> dict[str, Any]:
        if not token:
            return _err("webex_token is not configured")
        meeting_id = args.get("meetingId") or ""
        if not meeting_id:
            return _err("meetingId is required")
        try:
            data = await _get("/meetingSummaries", {"meetingId": meeting_id})
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        if "items" in data and isinstance(data["items"], list):
            items = data["items"]
            if not items:
                return _err(f"no summary found for meetingId={meeting_id}")
            summary = items[0]
        else:
            summary = data
        out = {
            "id": summary.get("id"),
            "meetingId": summary.get("meetingId"),
            "title": summary.get("title"),
            "summary": summary.get("summary"),
            "keywords": summary.get("keywords"),
            "highlights": summary.get("highlights"),
            "actionItems": summary.get("actionItems"),
        }
        return _ok(out)

    tools = [list_rooms, list_messages, get_message, get_person]
    if not messaging_only:
        tools.extend([list_meetings, list_transcripts, get_summary])
    return create_sdk_mcp_server(
        name="webex",
        version="0.1.0",
        tools=tools,
    )
