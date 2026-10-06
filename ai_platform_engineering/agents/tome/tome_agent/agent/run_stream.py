"""Shared SDK run loop for the tome agent's streaming agents.

Every streaming agent — source ingest (`ingestor.py`), BHAG synthesis
(`synthesize.py`), and future cross-project subagents (#66 integrity / graph
resolver, #42 compression) — builds its own `ClaudeAgentOptions` + opening
prompt, then delegates the message→event streaming here. Centralizing it keeps
the event vocabulary (tool_call / tool_result / page_written / done / error /
log) identical across agents and out of each agent's body.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from dataclasses import replace
from datetime import datetime, timezone
from tempfile import NamedTemporaryFile

from claude_agent_sdk import (
    TERMINAL_TASK_STATUSES,
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    CLIJSONDecodeError,
    ResultMessage,
    SystemMessage,
    TaskNotificationMessage,
    TaskProgressMessage,
    TaskStartedMessage,
    TaskUpdatedMessage,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

from tome_agent.agent.http_client import ModelResolution
from tome_agent.orchestrator.contract import IngestEventPayload
from tome_agent.tracing import suppress_sensitive_evidence_tracing

log = logging.getLogger("tome_agent.agent.run_stream")


@contextmanager
def _file_backed_system_prompt(
    options: ClaudeAgentOptions,
) -> Iterator[ClaudeAgentOptions]:
    """Keep the complete prompt out of argv and remove its private file on exit.

    Linux limits each process argument independently of the total argv size.
    Transcripts can exceed that limit. The SDK supports a system-prompt file;
    keep it alive for the entire session, outside the agent's wiki workspace.
    """
    prompt = getattr(options, "system_prompt", None)
    if not isinstance(prompt, str):
        yield options
        return
    with NamedTemporaryFile(
        mode="w", encoding="utf-8", prefix="tome-system-prompt-", suffix=".txt"
    ) as prompt_file:
        prompt_file.write(prompt)
        prompt_file.flush()
        yield replace(
            options, system_prompt={"type": "file", "path": prompt_file.name}
        )


def agent_event_failed(event: IngestEventPayload) -> bool:
    """A closed stream is not proof of a successful agent result."""
    return event.type == "error" or (
        event.type == "done"
        and (event.data.get("is_error") is True or event.data.get("subtype") != "success")
    )


def _restricted_stream_error_message(error: Exception) -> str:
    """Classify known SDK failures without exposing source data or stderr."""
    if isinstance(error, CLIJSONDecodeError) and re.fullmatch(
        r"JSON message exceeded maximum buffer size of [0-9]+ bytes", error.line
    ):
        return (
            "Agent SDK message buffer limit exceeded while reading source evidence; "
            "ask an administrator to review document batching and SDK buffer limits."
        )
    return "restricted evidence agent stream failed"


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def emit_log(line: str) -> IngestEventPayload:
    return IngestEventPayload(type="log", data={"line": line, "ts": now_iso()})


def stringify_tool_input(value: object) -> str:
    try:
        return json.dumps(value, separators=(", ", "="))[:300]
    except Exception:
        return str(value)[:300]


def _tool_result_text(content: object) -> str:
    """Normalize SDK tool-result content into text for small metadata reads."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if isinstance(item, dict):
            text = item.get("text")
        else:
            text = getattr(item, "text", None)
        if isinstance(text, str):
            parts.append(text)
    return "".join(parts)


def confluence_tree_coverage(
    tool_label: str,
    content: object,
) -> dict[str, object] | None:
    """Extract reader-facing coverage from a complete-tree tool result."""
    if not tool_label.endswith("confluence_get_page_tree"):
        return None
    text = _tool_result_text(content)
    if not text:
        return None
    try:
        payload = json.loads(text)
    except (TypeError, ValueError):
        return None
    fields = payload.get("page_fields")
    pages = payload.get("pages")
    if not isinstance(fields, list) or not isinstance(pages, list):
        return None
    try:
        id_index = fields.index("id")
        title_index = fields.index("title")
        body_index = fields.index("body")
    except ValueError:
        return None
    root_id = str(payload.get("root_page_id") or "")
    root_title = ""
    pages_with_content = 0
    for page in pages:
        if not isinstance(page, list):
            continue
        if (
            body_index < len(page)
            and isinstance(page[body_index], str)
            and page[body_index]
        ):
            pages_with_content += 1
        if (
            not root_title
            and id_index < len(page)
            and str(page[id_index] or "") == root_id
            and title_index < len(page)
        ):
            root_title = str(page[title_index] or "")
    if not root_title and pages and isinstance(pages[0], list):
        first = pages[0]
        if title_index < len(first):
            root_title = str(first[title_index] or "")
    return {
        "root_title": root_title or root_id or "Confluence page tree",
        "total_pages": len(pages),
        "pages_with_content": pages_with_content,
        "tree_truncated": payload.get("tree_truncated") is True,
    }


# Anthropic usage-block keys → the short keys we surface to the ingest pane.
_USAGE_FIELDS = {
    "input": "input_tokens",
    "output": "output_tokens",
    "cache_read": "cache_read_input_tokens",
    "cache_write": "cache_creation_input_tokens",
}


def extract_usage(usage: dict | None) -> dict[str, int]:
    """Pull the token counts we display from an SDK message's `usage` block.
    Only positive integers survive, so an empty/partial block yields {}."""
    if not usage:
        return {}
    out: dict[str, int] = {}
    for short, key in _USAGE_FIELDS.items():
        v = usage.get(key)
        if isinstance(v, int) and v > 0:
            out[short] = v
    return out


async def _consume_agent_query(
    prompt: str,
    options,
    log_buf: list[IngestEventPayload],
    *,
    model_provenance: ModelResolution | None = None,
    redact_sensitive_content: bool = False,
) -> AsyncIterator[IngestEventPayload]:
    """Run the SDK query and translate each message into IngestEventPayloads,
    draining `log_buf` (the persist hook's `page_written` events) as it goes.

    `log_buf` is the same list the caller's `on_write` hook appends to; passing
    it in lets page-write events interleave with tool/text events in order.

    `redact_sensitive_content` is used solely for the bounded MyAgent evidence
    pass. The model can see delegated content there, but run logs must not.
    """
    result_seen = False
    tool_call_count = 0
    tool_call_names: dict[str, str] = {}
    # Running token totals across every model turn (top-level and subagent).
    # Only `output` and `input` are summed — they're fresh each turn, so they
    # accumulate. `cache_read` is NOT summed: every turn re-reads the same cached
    # prefix, so summing it counts one ~40k context N times (a misleading 700k+).
    usage_acc: dict[str, int] = {}
    _ADDITIVE_USAGE = ("output", "input")
    # Per-subagent state so nested work surfaces in the log instead of a silent
    # multi-minute gap (#69). `subagent_desc` labels the terminal line; the SDK
    # emits a terminal status via either a TaskNotification or a TaskUpdated, so
    # whichever fires first clears the entry and the other becomes a no-op.
    subagent_desc: dict[str, str] = {}
    subagent_last_tool: dict[str, str] = {}
    try:
        async with ClaudeSDKClient(options=options) as client:
            await client.query(prompt)
            async for message in client.receive_response():
                # Drain any persist-hook events accumulated since the last yield.
                while log_buf:
                    yield log_buf.pop(0)

                if isinstance(message, AssistantMessage):
                    # Messages from a subagent carry the parent Task's tool_use id;
                    # render them indented so they read as nested subagent activity.
                    nested = getattr(message, "parent_tool_use_id", None) is not None
                    for block in message.content:
                        if isinstance(block, ToolUseBlock):
                            short = block.name.replace("mcp__github__", "gh.")
                            if nested:
                                detail = (
                                    "[input suppressed]"
                                    if redact_sensitive_content
                                    else stringify_tool_input(block.input)
                                )
                                yield emit_log(f"    ↳ {short} {detail}")
                                continue
                            tool_call_count += 1
                            tool_call_names[block.id] = short
                            yield IngestEventPayload(
                                type="tool_call",
                                data={
                                    "id": block.id,
                                    "tool": short,
                                    "input": (
                                        "[input suppressed]"
                                        if redact_sensitive_content
                                        else stringify_tool_input(block.input)
                                    ),
                                    "ts": now_iso(),
                                },
                            )
                        elif isinstance(block, TextBlock):
                            text = (block.text or "").strip()
                            if text:
                                prefix = "    ↳ ~" if nested else "~"
                                if redact_sensitive_content:
                                    yield emit_log(
                                        f"{prefix} [assistant text suppressed]"
                                    )
                                else:
                                    for line in text.splitlines():
                                        if line.strip():
                                            yield emit_log(f"{prefix} {line}")
                    # Fold this turn's additive usage into the running total. Emit a
                    # live snapshot only on top-level turns — subagent turns are
                    # already summed in, and the next top-level snapshot reflects them.
                    turn_usage = extract_usage(getattr(message, "usage", None))
                    for k in _ADDITIVE_USAGE:
                        if k in turn_usage:
                            usage_acc[k] = usage_acc.get(k, 0) + turn_usage[k]
                    if turn_usage and not nested:
                        yield IngestEventPayload(
                            type="usage",
                            data={**usage_acc, "ts": now_iso()},
                        )
                        # Exact context-window occupancy from the CLI's own live
                        # accounting (same number `/context` shows) — accounts for
                        # system prompt, tool defs, memory files, and the real
                        # model max/autocompact threshold, unlike the additive
                        # usage_acc above. Best-effort: a transport hiccup here
                        # must not fail the ingest turn.
                        try:
                            ctx = await client.get_context_usage()
                            yield IngestEventPayload(
                                type="context_usage",
                                data={
                                    "percentage": ctx.get("percentage"),
                                    "total_tokens": ctx.get("totalTokens"),
                                    "max_tokens": ctx.get("maxTokens"),
                                    "model": ctx.get("model"),
                                    "ts": now_iso(),
                                },
                            )
                        except Exception:
                            if redact_sensitive_content:
                                log.debug(
                                    "restricted evidence context usage unavailable; details suppressed"
                                )
                            else:
                                log.debug(
                                    "get_context_usage failed; skipping snapshot",
                                    exc_info=True,
                                )
                elif isinstance(message, UserMessage):
                    # Skip a subagent's internal tool results — the task_progress
                    # heartbeat already conveys the subagent is alive and working.
                    if getattr(message, "parent_tool_use_id", None) is not None:
                        continue
                    for block in getattr(message, "content", []) or []:
                        kind = getattr(block, "type", None) or (
                            block.get("type") if isinstance(block, dict) else None
                        )
                        if isinstance(block, ToolResultBlock) or kind == "tool_result":
                            tool_id = getattr(block, "tool_use_id", None) or (
                                block.get("tool_use_id")
                                if isinstance(block, dict)
                                else None
                            )
                            is_error = getattr(block, "is_error", False) or (
                                block.get("is_error", False)
                                if isinstance(block, dict)
                                else False
                            )
                            label = tool_call_names.get(tool_id or "", "?")
                            content = getattr(block, "content", None) or (
                                block.get("content")
                                if isinstance(block, dict)
                                else None
                            )
                            coverage = (
                                None
                                if redact_sensitive_content
                                else confluence_tree_coverage(label, content)
                            )
                            if coverage and not is_error:
                                limit_note = (
                                    " · source limit reached"
                                    if coverage["tree_truncated"]
                                    else ""
                                )
                                yield emit_log(
                                    "· Confluence "
                                    f"{coverage['root_title']} · loaded "
                                    f"{coverage['total_pages']} pages "
                                    f"({coverage['pages_with_content']} with content)"
                                    f"{limit_note}"
                                )
                                continue
                            if is_error:
                                log.debug(
                                    "tool result error: tool=%s id=%s", label, tool_id
                                )
                            yield IngestEventPayload(
                                type="tool_result",
                                data={
                                    "id": tool_id,
                                    "label": label,
                                    "is_error": is_error,
                                    "ts": now_iso(),
                                },
                            )
                elif isinstance(message, TaskStartedMessage):
                    desc = (
                        "[description suppressed]"
                        if redact_sensitive_content
                        else (message.description or "subagent").strip()
                    )
                    subagent_desc[message.task_id] = desc
                    kind = f" [{message.task_type}]" if message.task_type else ""
                    yield emit_log(f"  ↳ subagent started{kind}: {desc[:160]}")
                elif isinstance(message, TaskProgressMessage):
                    # Heartbeat: emit only when the subagent's active tool changes, so
                    # a long subagent shows steady progress without flooding the log.
                    tool = (message.last_tool_name or "").strip()
                    if tool and subagent_last_tool.get(message.task_id) != tool:
                        subagent_last_tool[message.task_id] = tool
                        yield emit_log(f"    ↳ {tool.replace('mcp__github__', 'gh.')}")
                elif isinstance(message, TaskNotificationMessage):
                    subagent_desc.pop(message.task_id, None)
                    subagent_last_tool.pop(message.task_id, None)
                    if redact_sensitive_content:
                        tail = ": [summary suppressed]"
                    else:
                        raw = (message.summary or "").strip()
                        summary = raw.splitlines()[0] if raw else ""
                        tail = f": {summary[:160]}" if summary else ""
                    yield emit_log(f"  ↳ subagent {message.status}{tail}")
                elif isinstance(message, TaskUpdatedMessage):
                    # Terminal state can arrive only as a TaskUpdated (e.g. killed).
                    # Emit a closing line only if a TaskNotification hasn't already.
                    if (
                        message.status in TERMINAL_TASK_STATUSES
                        and message.task_id in subagent_desc
                    ):
                        subagent_desc.pop(message.task_id, None)
                        subagent_last_tool.pop(message.task_id, None)
                        yield emit_log(f"  ↳ subagent {message.status}")
                elif isinstance(message, SystemMessage):
                    if message.subtype == "init":
                        yield emit_log("· agent session opened")
                elif isinstance(message, ResultMessage):
                    result_seen = True
                    is_error = message.is_error or message.subtype != "success"
                    if is_error:
                        if redact_sensitive_content:
                            log.warning(
                                "restricted evidence run returned an error; details suppressed"
                            )
                        else:
                            log.warning(
                                "agent returned a failed result: subtype=%s errors=%s",
                                message.subtype,
                                getattr(message, "errors", None),
                            )
                    yield IngestEventPayload(
                        type="done",
                        data={
                            "subtype": message.subtype,
                            "is_error": is_error,
                            "model": options.model,
                            "model_provenance": dict(model_provenance or {}),
                            "turns": getattr(message, "num_turns", None),
                            "tool_calls": tool_call_count,
                            "cost_usd": getattr(message, "total_cost_usd", None),
                            # The cumulative additive total the pane watched climb.
                            "tokens": dict(usage_acc),
                            "ts": now_iso(),
                        },
                    )

            # Drain any remaining events after the loop ends.
            while log_buf:
                yield log_buf.pop(0)
            if not result_seen:
                yield IngestEventPayload(
                    type="error",
                    data={"message": "Agent stream ended without a completion result"},
                )

    except Exception as e:
        if result_seen:
            if redact_sensitive_content:
                log.warning(
                    "restricted evidence stream raised after result; details suppressed"
                )
            else:
                log.warning(
                    "agent stream raised after ResultMessage (skill tool-deny artifact, ignoring)",
                    exc_info=True,
                )
        else:
            message = (
                _restricted_stream_error_message(e)
                if redact_sensitive_content
                else f"{type(e).__name__}: {e}"
            )
            if redact_sensitive_content:
                log.warning("%s; details suppressed", message)
            else:
                log.exception("agent stream failed")
            yield IngestEventPayload(
                type="error",
                data={"message": message},
            )


async def consume_agent_query(
    prompt: str,
    options,
    log_buf: list[IngestEventPayload],
    *,
    model_provenance: ModelResolution | None = None,
    redact_sensitive_content: bool = False,
) -> AsyncIterator[IngestEventPayload]:
    """Run one agent turn, suppressing telemetry only for delegated evidence.

    OpenInference wraps the Claude SDK at process scope. Its standard
    OpenTelemetry suppression context must therefore cover the client query and
    response stream themselves, not just prompt construction. The inner loop
    separately avoids emitting model/tool data into the persisted ingest log.
    """
    with _file_backed_system_prompt(options) as file_options:
        if redact_sensitive_content:
            with suppress_sensitive_evidence_tracing():
                async for event in _consume_agent_query(
                    prompt,
                    file_options,
                    log_buf,
                    model_provenance=model_provenance,
                    redact_sensitive_content=True,
                ):
                    yield event
            return

        async for event in _consume_agent_query(
            prompt,
            file_options,
            log_buf,
            model_provenance=model_provenance,
        ):
            yield event
