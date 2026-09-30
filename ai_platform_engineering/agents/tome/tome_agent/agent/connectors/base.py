"""Connector ABC for the agent container — snapshot-driven, no sqlite.

`is_enabled(token)` / `build_mcp(token, ...)` take pre-resolved tokens;
sources arrive as `list[SourceItem]` (the request handler converts
`ProjectSnapshot` → sources). OAuth flows live in the backend. This
module imports only `pydantic` and `ttt.reports.schema` so the agent
image stays minimal.
"""

from __future__ import annotations

import hashlib
import logging
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Generic, TypeVar

from pydantic import BaseModel

from tome_agent.agent import http_client
from tome_agent.orchestrator.contract import AppendFetchLedgerEntryRequest
from tome_agent.reports.schema import PageSpec

log = logging.getLogger("tome_agent.agent.connectors.base")

ExtraT = TypeVar("ExtraT", bound=BaseModel)


@dataclass
class SourceItem:
    """Lightweight projection of a project source (repo / room / space) for
    use in prompts and logs. Built by the agent from `ProjectSnapshot`."""
    slug: str
    display_name: str
    extra: dict[str, Any] = field(default_factory=dict)


class Connector(ABC, Generic[ExtraT]):
    """Abstract base for an agent-side connector, generic over its extra
    payload type."""

    slug: str
    name: str
    source_prefix: str  # "repos" | "webex" | "confluence" | ...
    extra_model: type[ExtraT] | None = None  # Pydantic model for extra_data; None = no payload

    @abstractmethod
    def is_enabled(self, token: str) -> bool:
        """Return True if the agent has the credentials this connector
        needs to issue tool calls. Empty token still counts as 'enabled'
        when the MCP can degrade gracefully (GitHub / Webex), and as
        'disabled' when it can't (Confluence cloud requires both token +
        cloud id)."""

    @abstractmethod
    def build_mcp(self, *, token: str, sources: list[SourceItem]) -> object:
        """Return the in-process MCP server instance scoped to these
        sources. The agent attaches it to the SDK options."""

    @property
    @abstractmethod
    def mcp_tools(self) -> list[str]:
        """Fully-qualified tool names exposed by this connector's MCP
        server."""

    @abstractmethod
    def page_template(self) -> tuple[PageSpec, ...]:
        """Per-source page template — materialized per slug by the ingest
        agent."""

    @abstractmethod
    def system_prompt_block(
        self,
        sources: list[SourceItem],
        extra_data: ExtraT | None = None,
    ) -> str:
        """System prompt section describing this connector's sources and
        instructions."""

    def prompt_extension(self, extra_data: ExtraT | None) -> str:
        """Optional user-prompt extension (e.g. 'N meetings selected for
        ingestion'). Override in connectors that accept pre-selected
        items at ingest time."""
        return ""

    def log_lines(
        self, sources: list[SourceItem], extra_data: ExtraT | None = None
    ) -> list[str]:
        """Ingest log lines for this connector. Default: one line
        summarising sources."""
        if not sources:
            return []
        names = ", ".join(s.slug for s in sources)
        return [f"· {self.name}: {names}"]

    async def extra_context(
        self,
        sources: list[SourceItem],
        *,
        github_token: str = "",
    ) -> ExtraT | None:
        """Optional connector-fetched context (e.g. GitHub `.tome/wiki.md`
        steering). Returned as the connector's typed extra model so the
        ingestor can pass it straight through to system_prompt_block /
        log_lines / prompt_extension. Default: None."""
        return None

    def citation_urls(self, sources: list[SourceItem]) -> list[str]:
        """Extract URLs from sources. Used internally by connectors to
        build citation guidance. Connectors may override this to provide
        URLs for their specific source type."""
        return []

    def citation_guidance(self, sources: list[SourceItem]) -> str:
        """Connector-specific guidance for how to cite sources of this
        type in the agent's output. Returns empty string if no sources
        or no citation convention for this connector. Each connector
        teaches the agent its own citation format (GitHub: commit/issue/PR
        links; Webex: message permalinks; Confluence: page URLs; etc.)."""
        return ""

    def deep_research_guidance(self, sources: list[SourceItem]) -> str:
        """Connector-specific guidance on how to investigate deeply:
        when to use breadth-scan tools (list) vs depth tools (get), and
        how they compose for synthesis. Returns empty string if no sources
        or no investigation strategy for this connector."""
        return ""

    def parse_extra(self, raw: Any) -> ExtraT | None:
        """Parse the raw connector_data slot for this connector into its
        typed extra model. Returns None when there's no payload or the
        connector declares no model. Raises pydantic ValidationError on
        malformed input — the API boundary catches this and surfaces it
        as 422."""
        if raw is None or self.extra_model is None:
            return None
        if not isinstance(raw, dict):
            raise ValueError("must be an object")
        return self.extra_model.model_validate(raw)


def format_pages(specs: tuple[PageSpec, ...]) -> str:
    """Render a tuple of PageSpecs as a markdown bullet list for agent
    prompts."""
    return "\n".join(
        f"  - `{spec.path}` ({spec.kind}) — {spec.title}" for spec in specs
    )


# ---------- fetch-ledger recording ----------
#
# The single point every connector's tool calls pass through to produce a
# provenance record, independent of whether the agent ends up citing the
# result. See docs/docs/specs/2026-09-28-tome-source-fetch-ledger/. A
# connector "opts in" by decorating its tool functions with `record_fetch`
# (see mcp_github.py / mcp_confluence.py / mcp_webex.py) — there is no path
# for a tool result to reach the agent without going through here once a
# connector adopts it.

_REDACTED_ARG_PLACEHOLDER = "[redacted:{length}-char value]"


def redact_tool_args(args: dict[str, Any], allowed_keys: frozenset[str]) -> dict[str, Any]:
    """Keep only identifier-shaped arguments (repo slugs, page ids, numbers —
    values that already appear unredacted in the canonical URI) verbatim.
    Anything not on the connector's allowlist is replaced with a
    length-preserving placeholder, so a free-text argument (e.g. a search
    query) never reaches the ledger, while still recording that an argument
    was present and roughly how large it was."""
    redacted: dict[str, Any] = {}
    for key, value in args.items():
        if key in allowed_keys:
            redacted[key] = value
        else:
            length = len(str(value)) if value is not None else 0
            redacted[key] = _REDACTED_ARG_PLACEHOLDER.format(length=length)
    return redacted


def _extract_result_text(result: dict[str, Any]) -> str:
    """Pull the text block out of an MCP tool result shaped like
    `{"content": [{"type": "text", "text": "..."}], "is_error"?: bool}` — the
    shape every connector's `_ok()`/`_err()` helper already produces."""
    content = result.get("content")
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("text")
                if isinstance(text, str):
                    return text
    return ""


def record_fetch(
    *,
    connector: str,
    tool_name: str,
    allowed_arg_keys: frozenset[str],
    canonical_uri: Callable[[str, dict[str, Any]], str],
):
    """Decorator for an MCP tool implementation `async def fn(args) -> dict`.

    Wraps the call so every invocation — success or error — produces a fetch-
    ledger entry, regardless of whether the agent later cites, summarizes, or
    ignores the result (FR-003). Recording is best-effort: any failure while
    building or sending the entry is logged and swallowed here — it must
    never change the tool's actual return value or interrupt the agent loop.
    A missing active run id (e.g. a chat turn, which has no Run Ledger) is
    not an error; it just means this call isn't part of a tracked run, so
    nothing is recorded.
    """

    def decorator(
        fn: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
    ) -> Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]:
        async def wrapped(args: dict[str, Any]) -> dict[str, Any]:
            result = await fn(args)
            run_id = http_client.get_active_run_id()
            if run_id is None:
                return result
            try:
                is_error = bool(result.get("is_error"))
                text = _extract_result_text(result)
                entry = AppendFetchLedgerEntryRequest(
                    connector=connector,
                    tool_name=tool_name,
                    tool_args=redact_tool_args(args, allowed_arg_keys),
                    canonical_uri=canonical_uri(tool_name, args),
                    status="error" if is_error else "success",
                    content=None if is_error else text,
                    content_hash=(
                        None if is_error else hashlib.sha256(text.encode("utf-8")).hexdigest()
                    ),
                    error_message=text[:500] if is_error else None,
                    timestamp=datetime.now(UTC),
                )
                await http_client.append_fetch_ledger_entry(run_id, entry)
            except Exception:
                log.warning(
                    "fetch-ledger recording failed for %s.%s", connector, tool_name,
                    exc_info=True,
                )
            return result

        wrapped.__name__ = fn.__name__
        wrapped.__doc__ = fn.__doc__
        return wrapped

    return decorator
