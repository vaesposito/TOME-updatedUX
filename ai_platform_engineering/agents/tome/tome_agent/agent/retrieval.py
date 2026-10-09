"""Global native TOME reasoning over a private published Markdown view."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import AsyncIterator
from typing import Any, Literal
from uuid import uuid4

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from tome_agent import prompts
from tome_agent.agent import http_client
from tome_agent.agent.retrieval_context import (
    PublishedCorpus,
    SnapshotPreparationError,
    view_operation,
)
from tome_agent.orchestrator.contract import (
    ChatEventPayload,
    ProjectSnapshot,
    RetrievalMessage,
)

log = logging.getLogger(__name__)
MAX_MODEL_CALLS = 12
MAX_TOOL_CALLS = 32
MAX_EVIDENCE_CHARACTERS = 120_000


class ToolArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class PageArguments(ToolArguments):
    offset: int = Field(default=0, ge=0, le=20_000)
    limit: int = Field(default=100, ge=1, le=200)


class ListPagesArguments(PageArguments):
    project_slug: str = Field(min_length=1, max_length=500)


class ScopedArguments(PageArguments):
    project_slug: str | None = Field(default=None, min_length=1, max_length=500)
    entity_type: Literal["bhag", "area", "project"] | None = None


class GlobArguments(ScopedArguments):
    pattern: str = Field(default="**/*.md", min_length=1, max_length=512)


class SearchArguments(ScopedArguments):
    query: str = Field(min_length=1, max_length=256)
    mode: Literal["words", "literal"] = "words"
    path_glob: str = Field(default="**/*.md", min_length=1, max_length=512)
    context_lines: int = Field(default=2, ge=0, le=5)
    limit: int = Field(default=8, ge=1, le=20)


class ReadArguments(ToolArguments):
    project_slug: str = Field(min_length=1, max_length=500)
    path: str = Field(min_length=1, max_length=1024)
    offset: int = Field(default=0, ge=0, le=10_000_000)
    limit: int = Field(default=24_000, ge=1, le=48_000)
    start_line: int | None = Field(default=None, ge=1, le=10_000_000)
    end_line: int | None = Field(default=None, ge=1, le=10_000_000)


_TOOL_ARGUMENTS: dict[str, type[ToolArguments]] = {
    "list_projects": PageArguments,
    "list_project_pages": ListPagesArguments,
    "glob_pages": GlobArguments,
    "search_pages": SearchArguments,
    "read_project_page": ReadArguments,
}
_DESCRIPTIONS = {
    "list_projects": "List accessible BHAGs, areas and projects with their relationships. Paginate with next_offset.",
    "list_project_pages": "List one entity's published page paths, titles, headings and revision times. Paginate with next_offset.",
    "glob_pages": "Find paths across the authorized hierarchy using *, ?, and whole-segment **. Pattern is relative to each entity's wiki. Filter by project_slug or entity_type; paginate with next_offset.",
    "search_pages": "Search all authorized published Markdown. words ranks pages by matching terms and titles; literal uses bounded fixed-string ripgrep when available. Returns snippets with line ranges and citations. Read supporting sections before detailed claims. Filter by entity, type or path glob; paginate with next_offset.",
    "read_project_page": "Read published Markdown with revision metadata and exact citation. Use offsets or start_line/end_line for relevant sections. Continue with next_offset when truncated. Maximum 48,000 characters per read.",
}
TOOLS = [
    {
        "name": name,
        "description": _DESCRIPTIONS[name],
        "input_schema": arguments.model_json_schema(),
    }
    for name, arguments in _TOOL_ARGUMENTS.items()
]


def _event(kind: str, **data: Any) -> ChatEventPayload:
    return ChatEventPayload(type=kind, data=data)


async def _read(
    name: str,
    arguments: dict[str, Any],
    corpus: PublishedCorpus,
    actor_sub: str,
    scope_hash: str,
) -> dict[str, Any]:
    schema = _TOOL_ARGUMENTS.get(name)
    if not schema:
        raise ValueError("Unknown retrieval function")
    try:
        values = schema.model_validate(arguments).model_dump()
    except ValidationError as exc:
        raise ValueError("Invalid retrieval arguments") from exc
    # Every search/read checks current authority, including reads from a staged view.
    await http_client.fetch_retrieval(actor_sub, scope_hash, "scope", {})
    if name == "list_projects":
        result = corpus.list_projects(**values)
    elif name == "list_project_pages":
        result = corpus.list_pages(**values)
    elif name == "glob_pages":
        result = corpus.glob_pages(**values)
    elif name == "search_pages":
        result = await corpus.search_pages(**values)
    else:
        result = await view_operation(corpus.read_page, **values)
    # Revocation while searching must also stop previews and model tool results.
    await http_client.fetch_retrieval(actor_sub, scope_hash, "scope", {})
    return result


async def _reason(
    *,
    user_message: str,
    history: list[RetrievalMessage],
    model: str,
    corpus: PublishedCorpus,
    actor_sub: str,
    scope_hash: str,
    base_url: str,
    headers: dict[str, str],
) -> AsyncIterator[ChatEventPayload]:
    context, coverage = await view_operation(corpus.model_context, user_message)
    messages: list[dict[str, Any]] = [message.model_dump() for message in history]
    messages.append({"role": "user", "content": user_message})
    system = (
        prompts.load("GLOBAL_CHAT")
        + "\n\n<current_published_reference>\n"
        + context
        + "\n</current_published_reference>"
    )
    answer: list[str] = []
    evidence_characters = 0
    tool_calls = 0
    async with httpx.AsyncClient(timeout=60.0) as client:
        for _ in range(MAX_MODEL_CALLS):
            await http_client.fetch_retrieval(actor_sub, scope_hash, "scope", {})
            response = await client.post(
                f"{base_url}/v1/messages",
                headers=headers,
                json={
                    "model": model,
                    "max_tokens": 8192,
                    "system": system,
                    "messages": messages,
                    "tools": TOOLS,
                },
            )
            response.raise_for_status()
            payload = response.json()
            blocks = payload.get("content")
            if (
                not isinstance(blocks, list)
                or not blocks
                or any(not isinstance(block, dict) for block in blocks)
                or payload.get("stop_reason") not in {"end_turn", "tool_use"}
            ):
                raise ValueError("Model response did not complete")
            await http_client.fetch_retrieval(actor_sub, scope_hash, "scope", {})
            messages.append({"role": "assistant", "content": blocks})
            calls = [block for block in blocks if block.get("type") == "tool_use"]
            for block in blocks:
                if block.get("type") == "text" and isinstance(block.get("text"), str):
                    answer.append(block["text"])
                    yield _event("token", text=block["text"])
            if not calls:
                if payload.get("stop_reason") != "end_turn" or not answer:
                    raise ValueError("Missing model answer")
                transcript = [message.model_dump() for message in history] + [
                    {"role": "user", "content": user_message},
                    {"role": "assistant", "content": "\n\n".join(answer)[-12_000:]},
                ]
                yield _event("session", retrieval_history=transcript[-8:])
                yield _event(
                    "done",
                    model=model,
                    runtime="tome-retrieval",
                    success=True,
                    context_coverage=coverage,
                )
                return
            results: list[dict[str, Any]] = []
            for call in calls:
                tool_calls += 1
                if tool_calls > MAX_TOOL_CALLS:
                    raise ValueError("Retrieval function budget exhausted")
                call_id, name, arguments = (
                    call.get("id"),
                    call.get("name"),
                    call.get("input"),
                )
                if (
                    not isinstance(call_id, str)
                    or not isinstance(name, str)
                    or not isinstance(arguments, dict)
                ):
                    raise TypeError("Invalid model function call")
                yield _event("tool_call", id=call_id, tool=name, input=arguments)
                failed = False
                try:
                    if evidence_characters >= MAX_EVIDENCE_CHARACTERS:
                        raise ValueError(
                            "Additional evidence budget exhausted; answer with available evidence and disclose coverage"
                        )
                    result = await _read(name, arguments, corpus, actor_sub, scope_hash)
                    result_text = json.dumps(result, ensure_ascii=False)
                    if len(result_text) + evidence_characters > MAX_EVIDENCE_CHARACTERS:
                        raise ValueError(
                            "Result exceeds the remaining evidence budget; request fewer matches or a smaller section"
                        )
                    evidence_characters += len(result_text)
                except ValueError as exc:
                    failed = True
                    result_text = json.dumps({"error": str(exc)})
                yield _event(
                    "tool_result",
                    id=call_id,
                    preview=result_text[:500],
                    is_error=failed,
                )
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": call_id,
                        "content": result_text,
                        "is_error": failed,
                    }
                )
            messages.append({"role": "user", "content": results})
    raise ValueError("Retrieval turn budget exhausted")


async def stream_retrieval(
    *,
    user_message: str,
    snapshot: ProjectSnapshot,
    actor_sub: str,
    scope_hash: str,
    history: list[RetrievalMessage],
    model: str,
) -> AsyncIterator[ChatEventPayload]:
    """Stage, reason and clean up within a bounded caller/conversation turn."""
    base_url = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip(
        "/"
    )
    api_key, auth_token = (
        os.environ.get("ANTHROPIC_API_KEY"),
        os.environ.get("ANTHROPIC_AUTH_TOKEN"),
    )
    if not api_key and not auth_token:
        yield _event("error", message="TOME model connection is not configured.")
        return
    headers = {"anthropic-version": "2023-06-01"}
    if api_key:
        headers["x-api-key"] = api_key
    else:
        headers["Authorization"] = f"Bearer {auth_token}"
    corpus: PublishedCorpus | None = None
    preparation_id = f"context-{uuid4().hex}"
    preparing = True
    try:
        async with asyncio.timeout(270):
            corpus = PublishedCorpus(actor_sub, snapshot)
            yield _event(
                "tool_call",
                id=preparation_id,
                tool="prepare_tome_context",
                input={"mode": "published-user-scope"},
            )
            await corpus.prepare(actor_sub, scope_hash)
            yield _event(
                "tool_result",
                id=preparation_id,
                preview=json.dumps(
                    {
                        "entities": len(corpus.entities),
                        "published_pages": len(corpus.pages),
                        "corpus_bytes": corpus.total_bytes,
                        "capture_started_at": corpus.captured_at,
                        "capture_completed_at": corpus.completed_at,
                        "mode": "private-read-only-view",
                    }
                ),
                is_error=False,
            )
            preparing = False
            async for event in _reason(
                user_message=user_message,
                history=history,
                model=model,
                corpus=corpus,
                actor_sub=actor_sub,
                scope_hash=scope_hash,
                base_url=base_url,
                headers=headers,
            ):
                yield event
    except SnapshotPreparationError as exc:
        log.warning("Global TOME published snapshot rejected")
        yield _event("tool_result", id=preparation_id, preview=str(exc), is_error=True)
        yield _event("error", message=str(exc))
    except httpx.HTTPStatusError as exc:
        log.warning("Global TOME HTTP failure: status=%s", exc.response.status_code)
        message = (
            "TOME access changed or the session is unavailable; retry with current permissions."
            if exc.response.status_code in {401, 403, 409}
            else "TOME context or model request failed; retry the turn."
        )
        if preparing:
            yield _event(
                "tool_result", id=preparation_id, preview=message, is_error=True
            )
        yield _event("error", message=message)
    except (
        httpx.RequestError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        TimeoutError,
    ) as exc:
        log.warning("Global TOME failed: %s", type(exc).__name__)
        message = (
            "TOME published context could not be prepared. Retry or narrow the scope; no partial snapshot was used."
            if preparing
            else "TOME did not complete the answer. Retry with a narrower question."
        )
        if preparing:
            yield _event(
                "tool_result", id=preparation_id, preview=message, is_error=True
            )
        yield _event("error", message=message)
    finally:
        if corpus:
            await view_operation(corpus.close)
