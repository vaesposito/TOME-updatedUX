"""Selected documents must produce visible source pages, not just memory notes."""

from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest

from tome_agent.agent import ingestor
from tome_agent.agent.sharepoint_documents import PreparedDocument
from tome_agent.orchestrator.contract import IngestEventPayload, ProjectSnapshot
from tome_agent.reports import schema


def document(tmp_path: Path, **metadata: str) -> PreparedDocument:
    return PreparedDocument(
        tmp_path / "prepared",
        {
            "drive_id": "drive-1", "item_id": "item-1", "version": '"etag,1"',
            "name": "Garden Survey.pdf", "web_url": "https://example.sharepoint.com/garden.pdf",
            **metadata,
        },
        {"batches": [{"path": "pages-0001-0002.pdf", "source_slides": [1, 2]}], "warnings": []},
    )


def markdown(source: PreparedDocument, **frontmatter: object) -> str:
    return schema.serialize_frontmatter(
        {**source.wiki_frontmatter(), **frontmatter},
        "## Summary\n\nA document-specific summary grounded in the source.\n\n"
        "## Source\n\n[Original document](https://example.sharepoint.com/garden.pdf), pages 1–2.\n",
    )


def test_page_identity_is_stable_across_name_version_and_url_changes(tmp_path: Path) -> None:
    original = document(tmp_path)
    renamed = document(tmp_path, name="Renamed.pdf", version='"etag,2"', web_url="https://example.sharepoint.com/renamed.pdf")
    assert original.wiki_path == renamed.wiki_path
    assert original.document_key == renamed.document_key
    assert original.wiki_frontmatter()["source_version"] != renamed.wiki_frontmatter()["source_version"]
    assert original.wiki_path.startswith("sharepoint/doc-")
    assert original.wiki_path.endswith(".md")


def test_identical_names_from_different_items_or_drives_do_not_collide(tmp_path: Path) -> None:
    paths = {
        document(tmp_path).wiki_path,
        document(tmp_path, item_id="item-2").wiki_path,
        document(tmp_path, drive_id="drive-2").wiki_path,
    }
    assert len(paths) == 3


def test_prompt_lists_exact_page_and_safe_prepared_text_discovery(tmp_path: Path) -> None:
    source = document(tmp_path)
    prompt = source.prompt_block()
    assert source.wiki_path in prompt
    assert "source_document_key:" in prompt
    assert "source_version: sha256:" in prompt
    assert "relative `pattern` `slide-*.md` or `page-*.txt`" in prompt
    tree = schema.build_tree({source.wiki_path: markdown(source)})
    assert tree[0].path == "sharepoint"
    assert tree[0].title == "SharePoint"
    assert tree[0].children[0].title == "Garden Survey.pdf"


def test_current_page_requires_visible_content_and_matching_source_version(tmp_path: Path) -> None:
    source = document(tmp_path)
    assert source.matches_wiki_page(markdown(source))
    assert not source.matches_wiki_page(schema.serialize_frontmatter(source.wiki_frontmatter(), ""))
    for override in (
        {"source_document_key": "doc-other"}, {"source_provider": "other"},
        {"source_version": "sha256:old"}, {"kind": "hidden"}, {"kind": "stable"},
    ):
        assert not source.matches_wiki_page(markdown(source, **override))
    protected = markdown(source, kind="stable", source_version="sha256:old")
    assert source.matches_wiki_page(protected, allow_protected=True)


async def run_document_pass(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    documents: list[PreparedDocument],
    *,
    existing: dict[str, str] | None = None,
    writes: dict[str, str] | None = None,
    confirm_persist: bool = True,
) -> tuple[list[IngestEventPayload], list[dict[str, Any]]]:
    monkeypatch.setenv("TTT_PROJECT_ROOT", str(tmp_path / "wiki"))
    monkeypatch.setattr(ingestor, "build_agent_options", lambda **kwargs: kwargs)
    calls: list[dict[str, Any]] = []

    async def consume(_prompt: str, options: dict[str, Any], log_buf: list[IngestEventPayload], **_kwargs: Any):
        calls.append({"prompt": _prompt, "options": options})
        for path, body in (writes or {}).items():
            target = tmp_path / "wiki" / "project-1" / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(body)
            if confirm_persist:
                await options["on_write"](path, len(body))
        while log_buf:
            yield log_buf.pop(0)
        yield IngestEventPayload(type="done", data={"subtype": "success"})

    monkeypatch.setattr(ingestor, "consume_agent_query", consume)
    events = [event async for event in ingestor.stream_sharepoint_documents(
        documents, snapshot=ProjectSnapshot(project_id="project-1", name="Network Test Harness"),
        report_id=uuid4(), seed=None, is_greenfield=False, seed_stable_pages=False,
        model_provenance={"model": "claude-test"}, author="tester", existing_pages=existing or {},
    )]
    return events, calls


@pytest.mark.asyncio
async def test_unrelated_document_requires_its_own_saved_source_page(monkeypatch, tmp_path) -> None:
    source = document(tmp_path)
    events, calls = await run_document_pass(monkeypatch, tmp_path, [source], writes={source.wiki_path: markdown(source)})
    assert events[-1].type == "done"
    assert not any(event.type == "error" for event in events)
    assert source.wiki_path in calls[0]["options"]["system_prompt"]
    assert "Project name, charter, topic mismatch" in calls[0]["options"]["system_prompt"]
    assert "must NOT be used to reject it as out-of-scope" in calls[0]["options"]["system_prompt"]
    assert "even if its topic is unrelated" in calls[0]["prompt"]


@pytest.mark.asyncio
async def test_memory_only_success_becomes_explicit_failure_without_retry(monkeypatch, tmp_path) -> None:
    events, calls = await run_document_pass(monkeypatch, tmp_path, [document(tmp_path)], writes={"memory.md": "Source was unrelated."})
    assert events[-1].type == "error"
    assert "memory-only update is not sufficient" in events[-1].data["message"]
    assert "No automatic retry" in events[-1].data["message"]
    assert not any(event.type == "done" for event in events)
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_local_file_without_confirmed_persistence_does_not_count(monkeypatch, tmp_path) -> None:
    source = document(tmp_path)
    events, _ = await run_document_pass(monkeypatch, tmp_path, [source], writes={source.wiki_path: markdown(source)}, confirm_persist=False)
    assert events[-1].type == "error"


@pytest.mark.asyncio
async def test_unchanged_existing_document_needs_no_rewrite(monkeypatch, tmp_path) -> None:
    source = document(tmp_path)
    events, calls = await run_document_pass(monkeypatch, tmp_path, [source], existing={source.wiki_path: markdown(source)})
    assert events[-1].type == "done"
    assert events[-1].data["tool_calls"] == 0
    assert calls == []
    assert not any(event.type == "page_written" for event in events)


@pytest.mark.asyncio
async def test_changed_version_cannot_pass_with_only_the_old_page(monkeypatch, tmp_path) -> None:
    source = document(tmp_path)
    old = document(tmp_path, version="old-version")
    events, _ = await run_document_pass(monkeypatch, tmp_path, [source], existing={source.wiki_path: markdown(old)})
    assert events[-1].type == "error"


@pytest.mark.asyncio
async def test_human_pinned_document_is_preserved_without_an_alternate_copy(monkeypatch, tmp_path) -> None:
    source = document(tmp_path)
    prior = markdown(source, kind="stable", source_version="sha256:old")
    events, _ = await run_document_pass(monkeypatch, tmp_path, [source], existing={source.wiki_path: prior})
    assert events[-1].type == "done"
    assert any("user-protected" in event.data.get("line", "") for event in events)
    assert not any(event.type == "page_written" for event in events)


@pytest.mark.asyncio
async def test_unchanged_page_never_starts_a_model_rewrite(monkeypatch, tmp_path) -> None:
    source = document(tmp_path)
    events, calls = await run_document_pass(monkeypatch, tmp_path, [source], existing={source.wiki_path: markdown(source)}, writes={source.wiki_path: "An invalid replacement."})
    assert events[-1].type == "done"
    assert calls == []


@pytest.mark.asyncio
async def test_mixed_selection_sends_only_new_and_changed_files_to_the_model(monkeypatch, tmp_path) -> None:
    unchanged = document(tmp_path)
    changed = document(tmp_path, item_id="item-2", version="v2")
    old = document(tmp_path, item_id="item-2", version="v1")
    new = document(tmp_path, item_id="item-3")
    existing = {unchanged.wiki_path: markdown(unchanged), old.wiki_path: markdown(old)}
    events, calls = await run_document_pass(monkeypatch, tmp_path, [unchanged, changed, new], existing=existing,
        writes={changed.wiki_path: markdown(changed), new.wiki_path: markdown(new)})
    assert events[-1].type == "done"
    assert len(calls) == 1
    prompt = calls[0]["options"]["system_prompt"]
    assert f"Required dedicated wiki page: `{unchanged.wiki_path}`" not in prompt
    assert f"Required dedicated wiki page: `{changed.wiki_path}`" in prompt
    assert f"Required dedicated wiki page: `{new.wiki_path}`" in prompt


@pytest.mark.asyncio
async def test_every_selected_document_requires_its_own_page(monkeypatch, tmp_path) -> None:
    first, second = document(tmp_path), document(tmp_path, item_id="item-2")
    events, _ = await run_document_pass(monkeypatch, tmp_path, [first, second], writes={first.wiki_path: markdown(first)})
    assert events[-1].type == "error"
    assert "1 required document page" in events[-1].data["message"]
