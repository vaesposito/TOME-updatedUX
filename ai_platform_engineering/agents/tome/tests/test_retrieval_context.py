"""Private published views reject incomplete, unauthorized and unsafe evidence."""

import asyncio
import hashlib
import json
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from tome_agent.agent.retrieval_context import PublishedCorpus
from tome_agent.orchestrator.contract import ChildProjectSnapshot, ProjectSnapshot


@pytest.fixture
def corpus() -> Iterator[PublishedCorpus]:
    view = PublishedCorpus("example-user", ProjectSnapshot(
        project_id="example-session", name="Example",
        readable_projects=[ChildProjectSnapshot(project_id="primary", slug="primary", name="Primary")],
    ))
    try:
        yield view
    finally:
        if view.root.exists():
            view.close()


def page_frame(path: str = "roadmap.md", markdown: str = "# Roadmap\nMilestone is ready.\n") -> dict[str, Any]:
    return {
        "type": "page", "project_id": "primary", "project_slug": "primary",
        "path": path, "markdown": markdown, "revision_id": "example-revision",
        "content_hash": hashlib.sha256(markdown.encode()).hexdigest(),
        "captured_at": "2026-01-01T00:00:00Z", "updated_at": "2025-12-31T00:00:00Z",
    }


def snapshot_frames(corpus: PublishedCorpus) -> list[dict[str, Any]]:
    page = page_frame()
    digest = hashlib.sha256(json.dumps(
        ["primary", page["path"], page["content_hash"], page["revision_id"]],
        ensure_ascii=False, separators=(",", ":"),
    ).encode()).hexdigest()
    return [
        {"type": "catalog", "version": 1, "scope_hash": "example-scope",
         "captured_at": page["captured_at"], "catalog": [entity.model_dump() for entity in corpus.entities.values()]},
        page,
        {"type": "done", "scope_hash": "example-scope", "page_count": 1,
         "total_bytes": len(page["markdown"].encode()), "corpus_hash": digest,
         "completed_at": page["captured_at"]},
    ]


def prepare(corpus: PublishedCorpus, frames: list[dict[str, Any]]) -> AsyncMock:
    async def stream(*args: Any) -> AsyncIterator[dict[str, Any]]:
        for frame in frames:
            yield frame

    with (
        patch("tome_agent.agent.retrieval_context.http_client.stream_retrieval_snapshot", stream),
        patch("tome_agent.agent.retrieval_context.http_client.fetch_retrieval", new_callable=AsyncMock) as authorize,
    ):
        asyncio.run(corpus.prepare("example-user", "example-scope"))
    return authorize


def test_complete_snapshot_reauthorizes_before_loading_context(corpus: PublishedCorpus) -> None:
    authorize = prepare(corpus, snapshot_frames(corpus))
    authorize.assert_awaited_once_with("example-user", "example-scope", "scope", {})
    context, coverage = corpus.model_context("milestone")
    assert coverage["full_corpus_in_context"] is True
    assert "Milestone is ready" in context
    assert "/projects/primary/tome/wiki/roadmap.md" in context
    assert corpus.pages[("primary", "roadmap.md")].file.stat().st_mode & 0o777 == 0o400


@pytest.mark.parametrize("field,value", [
    ("scope_hash", "wrong-scope"), ("page_count", 2),
    ("total_bytes", 0), ("corpus_hash", "wrong-hash"), ("completed_at", None),
])
def test_incomplete_snapshot_never_builds_model_indexes(corpus: PublishedCorpus, field: str, value: Any) -> None:
    frames = snapshot_frames(corpus)
    frames[-1][field] = value
    with pytest.raises(ValueError):
        prepare(corpus, frames)
    assert corpus.index == ""


def test_missing_terminal_frame_rejects_partial_evidence(corpus: PublishedCorpus) -> None:
    with pytest.raises(ValueError, match="before completion"):
        prepare(corpus, snapshot_frames(corpus)[:-1])
    assert corpus.index == ""


@pytest.mark.parametrize("field,value", [
    ("project_id", "secondary"), ("project_slug", "secondary"),
    ("content_hash", "wrong-hash"), ("path", "../outside.md"),
    ("path", "/outside.md"), ("path", "notes.txt"),
])
def test_page_manifest_rejects_unauthorized_or_invalid_entries(corpus: PublishedCorpus, field: str, value: str) -> None:
    frame = page_frame()
    frame[field] = value
    with pytest.raises(ValueError):
        corpus._stage(frame, hashlib.sha256())
    assert not corpus.pages


@pytest.mark.parametrize("pattern", ["../*.md", "/**/*.md", "a/**b.md", "a//*.md", "**/[a].md"])
def test_glob_rejects_unsafe_patterns(corpus: PublishedCorpus, pattern: str) -> None:
    with pytest.raises(ValueError):
        corpus.select(pattern=pattern)


def test_reads_are_bounded_and_citations_are_revision_bound(corpus: PublishedCorpus) -> None:
    prepare(corpus, snapshot_frames(corpus))
    result = corpus.read_page("primary", "roadmap.md", 0, 5, 2, 2)
    assert result["markdown"] == "Miles"
    assert result["start_line"] == 2
    assert result["truncated"] is True
    assert result["revision_id"] == "example-revision"
    with pytest.raises(ValueError, match="unavailable"):
        corpus.read_page("secondary", "roadmap.md", 0, 100, None, None)


def test_literal_search_uses_only_selected_manifest(corpus: PublishedCorpus) -> None:
    prepare(corpus, snapshot_frames(corpus))
    (corpus.root / "unlisted.md").write_text("Milestone secret", encoding="utf-8")
    result = asyncio.run(corpus.search_pages("milestone", "literal", "primary", None, "**/*.md", 1, 0, 20))
    assert result["eligible_pages"] == 1
    assert len(result["matches"]) == 1
    assert result["matches"][0]["path"] == "roadmap.md"
    assert result["matches"][0]["match_line"] == 2
    assert "secret" not in str(result)


def test_symlink_reads_cannot_escape_private_view(corpus: PublishedCorpus, tmp_path: Path) -> None:
    prepare(corpus, snapshot_frames(corpus))
    page = corpus.pages[("primary", "roadmap.md")]
    outside = tmp_path / "outside.md"
    outside.write_text("Not authorized", encoding="utf-8")
    page.file.unlink()
    page.file.symlink_to(outside)
    with pytest.raises(ValueError, match="escaped"):
        corpus.text(page)


def test_private_views_are_unique_and_removed_on_close(corpus: PublishedCorpus) -> None:
    other = PublishedCorpus("secondary-user", ProjectSnapshot(project_id="example-session", name="Example"))
    try:
        assert other.root != corpus.root
        corpus.close()
        assert not corpus.root.exists()
        assert other.root.exists()
    finally:
        other.close()
