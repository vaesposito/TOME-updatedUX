"""Hard availability boundaries for untrusted delegated MyAgent evidence."""

import asyncio
from pathlib import Path

from tome_agent.agent import loop
from tome_agent.agent.confluence_reads import ConfluenceReadState
from tome_agent.agent.connectors.confluence import ConfluenceConnector
from tome_agent.agent.loop import (
    WIKI_TOOLS,
    build_agent_options,
    make_constrain_writes_hook,
    make_deny_non_wiki_tools_hook,
)
from tome_agent.orchestrator.contract import ProjectSnapshot


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _snapshot() -> ProjectSnapshot:
    return ProjectSnapshot(project_id="project-1", name="Example")


def test_restricted_evidence_options_expose_only_role_appropriate_wiki_tools(
    monkeypatch, tmp_path
) -> None:
    monkeypatch.setenv("TTT_PROJECT_ROOT", str(tmp_path))
    monkeypatch.setenv("TTT_AGENT_ROLE", "editor")

    options = build_agent_options(
        snapshot=_snapshot(),
        system_prompt="test",
        model="claude-haiku-4-5",
        max_turns=1,
        persist_author="tester",
        restrict_untrusted_evidence=True,
    )

    assert options.tools == WIKI_TOOLS
    assert options.allowed_tools == WIKI_TOOLS
    assert options.mcp_servers == {}
    assert options.strict_mcp_config is True
    assert options.setting_sources == []
    assert options.skills == []
    assert options.stderr is not None
    assert options.debug_stderr is False

    deny = make_deny_non_wiki_tools_hook(set(options.tools))
    result = _run(deny({"tool_name": "WebFetch", "tool_input": {}}, "id", {}))
    assert result["hookSpecificOutput"]["permissionDecision"] == "deny"


def test_restricted_viewer_never_gets_edit_or_write(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("TTT_PROJECT_ROOT", str(tmp_path))
    monkeypatch.setenv("TTT_AGENT_ROLE", "viewer")

    options = build_agent_options(
        snapshot=_snapshot(),
        system_prompt="test",
        model="claude-haiku-4-5",
        max_turns=1,
        persist_author="tester",
        restrict_untrusted_evidence=True,
    )

    assert options.tools == ["Read", "Glob", "Grep"]
    assert "Edit" not in options.tools
    assert "Write" not in options.tools


def test_write_hook_refuses_configuration_and_instruction_files(tmp_path) -> None:
    hook = make_constrain_writes_hook(Path(tmp_path))

    safe = _run(
        hook(
            {
                "tool_name": "Write",
                "tool_input": {"file_path": str(tmp_path / "overview.md")},
            },
            "id",
            {},
        )
    )
    assert safe == {}

    for path in (tmp_path / "CLAUDE.md", tmp_path / ".claude" / "settings.json"):
        denied = _run(
            hook(
                {"tool_name": "Write", "tool_input": {"file_path": str(path)}},
                "id",
                {},
            )
        )
        assert denied["hookSpecificOutput"]["permissionDecision"] == "deny"


def test_missing_confluence_credentials_remain_in_required_coverage(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("TTT_PROJECT_ROOT", str(tmp_path))
    monkeypatch.setenv("TTT_AGENT_ROLE", "viewer")
    monkeypatch.setattr(loop, "_connector_token", lambda slug: "")
    monkeypatch.setattr(ConfluenceConnector, "is_enabled", lambda self, token: False)
    state = ConfluenceReadState()
    snapshot = ProjectSnapshot(project_id="project-example", name="Example", confluence_spaces=[{
        "slug": "example", "name": "Example", "space_key": "EXAMPLE", "root_page_id": "999",
        "page_scopes": [{"page_id": "123"}, {"page_id": "456"}],
    }])
    options = build_agent_options(
        snapshot=snapshot, system_prompt="test", model="example-model", max_turns=1,
        persist_author="test-user", confluence_read_state=state,
    )
    assert "confluence" not in options.mcp_servers
    assert state.required_pages == {"123", "456"}
    assert state.incomplete_pages() == ["123", "456", "connection"]
