import asyncio

from tome_agent.agent import workspace


def test_refresh_replaces_a_stale_unapproved_draft_with_live_pages(
    monkeypatch,
    tmp_path,
) -> None:
    """A later normal turn must never see a draft left by a restricted pass."""
    monkeypatch.setenv("TTT_PROJECT_ROOT", str(tmp_path))
    project_dir = tmp_path / "project-1"
    project_dir.mkdir()
    stale_draft = project_dir / "delegated-evidence-draft.md"
    stale_draft.write_text("private MyAgent reply")
    monkeypatch.setattr(
        workspace.http_client,
        "fetch_all_pages_sync",
        lambda project_id: {"overview.md": f"# Live {project_id}"},
    )

    assert asyncio.run(workspace.refresh_project("project-1")) is True
    assert (project_dir / "overview.md").read_text() == "# Live project-1"
    assert not stale_draft.exists()


def test_refresh_returns_false_without_reusing_a_stale_workspace(
    monkeypatch,
    tmp_path,
) -> None:
    """Callers use this false result to reject the credentialed agent turn."""
    monkeypatch.setenv("TTT_PROJECT_ROOT", str(tmp_path))
    project_dir = tmp_path / "project-1"
    project_dir.mkdir()
    stale_draft = project_dir / "delegated-evidence-draft.md"
    stale_draft.write_text("private MyAgent reply")

    def unavailable(_: str) -> dict[str, str]:
        raise RuntimeError("backend unavailable")

    monkeypatch.setattr(workspace.http_client, "fetch_all_pages_sync", unavailable)

    assert asyncio.run(workspace.refresh_project("project-1")) is False
    # `refresh_project` itself never silently presents a partial replacement;
    # `_require_fresh_workspace` in every model-facing entry point rejects this.
    assert stale_draft.read_text() == "private MyAgent reply"
