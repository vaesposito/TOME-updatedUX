import json
from unittest.mock import AsyncMock

import httpx
import pytest
from pydantic import ValidationError

from tome_agent.agent import http_client
from tome_agent.agent.live_verification import (
    COMPARISON_TIMEOUT_SECONDS,
    LiveVerification,
    parse_comparison,
)


@pytest.mark.parametrize("fenced", [False, True])
def test_comparison_accepts_strict_json_with_optional_fence(fenced: bool) -> None:
    text = json.dumps({"answer": "Example answer", "claim_checks": [{
        "claim": "Example claim", "status": "unverified", "source_urls": [], "reason": "No evidence",
    }], "warnings": []})
    if fenced:
        text = "```json\n" + text + "\n```"
    assert parse_comparison(text).claim_checks[0].status == "unverified"


def test_comparison_rejects_non_json_prose() -> None:
    with pytest.raises(ValidationError):
        parse_comparison('Here is the answer: {"answer":"example"}')


@pytest.mark.asyncio
@pytest.mark.parametrize("reference", ["https://example.test/wiki/pages/123", "https://example.test/wiki/pages/456", None])
async def test_comparison_has_a_bounded_large_evidence_timeout_and_safe_references(
    monkeypatch: pytest.MonkeyPatch, reference: str | None,
) -> None:
    live = LiveVerification("test-user", "example-scope", "required", {"example"}, "example-grant")
    page = {"body": "example", "url": "https://example.test/wiki/pages/123",
        "source_version": 1, "source_revision_at": "2026-01-01T00:00:00Z", "read_at": "2026-01-02T00:00:00Z"}
    monkeypatch.setattr(live, "complete_evidence", lambda: [page])
    monkeypatch.setattr(http_client, "fetch_retrieval", AsyncMock())
    response = httpx.Response(200, request=httpx.Request("POST", "https://example.test/v1/messages"), json={
        "stop_reason": "end_turn", "content": [{"type": "text", "text": json.dumps({
            "answer": "Example answer", "claim_checks": [{"claim": "Example claim", "status": "supported",
                "source_urls": [reference] if reference else [], "reason": "Present in evidence"}], "warnings": [],
        })}],
    })
    client = AsyncMock()
    client.post.return_value = response
    _, verification = await live.compare(client, "https://example.test", {}, "example-model", "Question", "Answer")
    assert client.post.call_args.kwargs["timeout"] == COMPARISON_TIMEOUT_SECONDS
    assert 60 < COMPARISON_TIMEOUT_SECONDS < 290
    assert verification["status"] == "completed"
    if reference == page["url"]:
        assert verification["warnings"] == []
        assert verification["claim_checks"][0]["status"] == "supported"
    else:
        assert verification["warnings"]
        assert verification["claim_checks"][0]["status"] == "unverified"
        assert verification["claim_checks"][0]["source_urls"] == []
