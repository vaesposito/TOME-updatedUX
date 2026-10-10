"""Final emission and metadata share the same checked citation bindings."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from tome_agent.agent import http_client
from tome_agent.agent.citations import CitationLedger
from tome_agent.agent.live_verification import LiveVerification
from tome_agent.agent.retrieval import _reason


class Corpus:
    def __init__(self) -> None:
        self.navigation = {"entities": []}
        self.entities = {"primary": SimpleNamespace(name="Primary")}
        self.pages = {}
        for path in ("roadmap.md", "charter.md"):
            reference = {"citation": f"/projects/primary/tome/wiki/{path}", "project_slug": "primary", "path": path}
            self.pages[("primary", path)] = SimpleNamespace(reference=lambda ref=reference: ref,
                entity=SimpleNamespace(slug="primary"), path=path, title=path, revision_id="example-revision",
                updated_at="2026-01-01", captured_at="2026-01-02", content_hash="example-hash")

    def model_context(self, question: str) -> tuple[str, dict]:
        coverage = {"preloaded_pages": [{"project_slug": slug, "path": path} for slug, path in self.pages],
            "navigation_truncated": False, "full_corpus_in_context": True}
        return json.dumps({"published_document_reference": [{"source": page.reference(),
            "markdown": "Milestone is ready."} for page in self.pages.values()]}), coverage

    def text(self, page: SimpleNamespace) -> str:
        return "Milestone is ready."


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["off", "required"])
async def test_draft_is_not_emitted_before_the_citation_gate_and_consulted_are_separate(
    monkeypatch: pytest.MonkeyPatch, mode: str,
) -> None:
    scope = AsyncMock()
    monkeypatch.setattr(http_client, "fetch_retrieval", scope)
    client = AsyncMock()
    client.__aenter__.return_value = client
    client.post.return_value = httpx.Response(200, request=httpx.Request("POST", "https://example.test/v1/messages"), json={
        "stop_reason": "end_turn", "content": [{"type": "text", "text": "Unchecked draft"}],
    })
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: client)
    monkeypatch.setattr(LiveVerification, "finish_reads", AsyncMock())
    monkeypatch.setattr(LiveVerification, "compare", AsyncMock(return_value=("Rewritten draft without links", {
        "status": "completed", "live_sources": [], "claim_checks": [], "warnings": [],
    })))
    emitted = []
    checked = False
    url = "/projects/primary/tome/wiki/roadmap.md"

    async def cite(self: CitationLedger, *args: object, **kwargs: object) -> tuple[str, dict]:
        nonlocal checked
        assert not any(event.type == "token" for event in emitted)
        assert url in self.by_url
        checked = True
        return f"Milestone is ready. [Roadmap]({url})", {"status": "completed",
            "supporting_urls": [url], "missing_evidence": [], "bindings": []}

    monkeypatch.setattr(CitationLedger, "cite", cite)
    async for event in _reason(user_message="Milestone", history=[], model="example-model", corpus=Corpus(),
        actor_sub="example-user", scope_hash="example-scope", base_url="https://example.test", headers={},
        live_verification=mode, live_verification_grant="example-grant" if mode != "off" else None):
        emitted.append(event)
    assert checked
    tokens = [event.data["text"] for event in emitted if event.type == "token"]
    assert len(tokens) == 1 and "Unchecked draft" not in tokens[0]
    done = next(event.data for event in emitted if event.type == "done")
    assert [source["path"] for source in done["citations"]] == ["roadmap.md"]
    assert [source["path"] for source in done["sources_consulted"]] == ["charter.md"]
    assert done["context_coverage"]["citation_validation"]["status"] == "completed"
    assert scope.await_count >= 4


@pytest.mark.asyncio
async def test_revocation_after_citation_review_stops_final_emission(monkeypatch: pytest.MonkeyPatch) -> None:
    checked = False

    async def authorize(*args: object, **kwargs: object) -> dict:
        if checked:
            raise httpx.HTTPStatusError("revoked", request=httpx.Request("GET", "https://example.test/scope"),
                response=httpx.Response(403))
        return {}

    monkeypatch.setattr(http_client, "fetch_retrieval", authorize)
    client = AsyncMock()
    client.__aenter__.return_value = client
    client.post.return_value = httpx.Response(200, request=httpx.Request("POST", "https://example.test/v1/messages"), json={
        "stop_reason": "end_turn", "content": [{"type": "text", "text": "Milestone is ready."}],
    })
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: client)

    async def cite(*args: object, **kwargs: object) -> tuple[str, dict]:
        nonlocal checked
        checked = True
        return "Checked answer", {"status": "completed", "supporting_urls": [], "missing_evidence": [], "bindings": []}

    monkeypatch.setattr(CitationLedger, "cite", cite)
    emitted = []
    with pytest.raises(httpx.HTTPStatusError):
        async for event in _reason(user_message="Milestone", history=[], model="example-model", corpus=Corpus(),
            actor_sub="example-user", scope_hash="example-scope", base_url="https://example.test", headers={}):
            emitted.append(event)
    assert not any(event.type in {"token", "done", "session"} for event in emitted)
