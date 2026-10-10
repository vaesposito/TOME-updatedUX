"""Final citations use current evidence and never promote inspected-only sources."""

import json
from unittest.mock import AsyncMock

import httpx
import pytest

from tome_agent.agent.citations import (
    MAX_REVIEW_CHARACTERS,
    CitationLedger,
    CitationReview,
    answer_blocks,
    linked_urls,
    live_plain_text,
)

WIKI = "/projects/primary/tome/wiki/roadmap.md"
LIVE = "https://example.test/wiki/pages/123"


@pytest.fixture
def ledger() -> CitationLedger:
    result = CitationLedger()
    result.add({"citation": WIKI, "project_slug": "primary", "path": "roadmap.md",
        "revision_id": "primary-revision"}, "# Roadmap\nMilestone is ready but awaiting approval.\n", 1)
    result.add_live([{"url": LIVE, "body": '<p>Launch planning starts <time datetime="2026-01-02"/>.</p>',
        "content_revision": "live-revision", "read_coverage": "complete"}])
    return result


def review(bindings: list[dict]) -> CitationReview:
    return CitationReview.model_validate({"blocks": bindings})


def supported(block: int, source: str = "source-0", quote: str = "Milestone is ready but awaiting approval.") -> dict:
    return {"block_id": block, "status": "supported", "supports": [{"source_id": source, "quote": quote}], "reason": ""}


def render(ledger: CitationLedger, answer: str, bindings: list[dict]) -> tuple[str, dict]:
    return ledger.render(answer, answer_blocks(answer), review(bindings), ledger.review_evidence("milestone", answer, set()))


def test_preserves_wiki_support_and_adds_live_support_beside_each_claim(ledger: CitationLedger) -> None:
    answer = "Milestone is ready but awaiting approval.\n\nLaunch planning starts January 2."
    output, report = render(ledger, answer, [supported(0), supported(1, "source-1", "Launch planning starts 2026-01-02")])
    assert output.split("\n\n")[0].endswith(f"]({WIKI})")
    assert output.split("\n\n")[1].endswith(f"]({LIVE})")
    assert report["supporting_urls"] == sorted([WIKI, LIVE])
    assert report["bindings"][0]["start_line"] == 2
    assert report["bindings"][0]["revision_id"] == "primary-revision"
    assert report["bindings"][1]["line_basis"] == "live_plain_text"


def test_table_rows_get_links_inside_the_row_and_all_supporting_sources(ledger: CitationLedger) -> None:
    answer = "| Item | Progress |\n| --- | --- |\n| Primary | Ready, awaiting approval; planning starts January 2 |\n"
    binding = supported(0)
    binding["supports"].append({"source_id": "source-1", "quote": "Launch planning starts 2026-01-02"})
    output, report = render(ledger, answer, [binding])
    assert len(answer_blocks(answer)) == 1
    assert output.splitlines()[2].endswith(f"]({LIVE}) |")
    assert f"]({WIKI})" in output.splitlines()[2]
    assert len(report["supporting_urls"]) == 2


def test_inspected_sources_are_separate_and_not_classified_as_support(ledger: CitationLedger) -> None:
    output, report = render(ledger, "Milestone is ready but awaiting approval.", [supported(0)])
    footer = ledger.consulted_list(set(report["supporting_urls"]))
    assert WIKI in output and LIVE not in output
    assert LIVE in footer and WIKI not in footer
    assert "not used to support" in footer


@pytest.mark.parametrize("change", ["unknown-source", "fabricated-quote", "omitted-block", "duplicate-block", "empty-support"])
def test_invalid_citation_mappings_are_rejected(ledger: CitationLedger, change: str) -> None:
    bindings = [supported(0)]
    if change == "unknown-source":
        bindings[0]["supports"][0]["source_id"] = "source-unauthorized"
    elif change == "fabricated-quote":
        bindings[0]["supports"][0]["quote"] = "Milestone was launched."
    elif change == "omitted-block":
        bindings = []
    elif change == "duplicate-block":
        bindings.append(supported(0))
    else:
        bindings[0]["supports"] = []
    with pytest.raises(ValueError):
        render(ledger, "Milestone is ready.", bindings)


def test_spoofed_host_and_old_model_links_are_replaced(ledger: CitationLedger) -> None:
    spoof = "https://untrusted.example.test" + WIKI
    output, report = render(ledger, f"Milestone is ready. [Roadmap]({spoof})", [supported(0)])
    assert linked_urls(output) == {WIKI}
    assert spoof not in output and spoof not in report["supporting_urls"]


def test_catalog_only_and_unread_portions_cannot_support_a_quote() -> None:
    ledger = CitationLedger()
    ledger.collect({"citation": WIKI, "title": "Roadmap", "overview_excerpt": "Milestone was launched."})
    assert not ledger.sources
    ledger.collect({"citation": WIKI, "snippet": "Milestone is ready.", "start_line": 8})
    with pytest.raises(ValueError, match="absent"):
        render(ledger, "Milestone was launched.", [supported(0, quote="Milestone was launched.")])
    _, report = render(ledger, "Milestone is ready.", [supported(0, quote="Milestone is ready.")])
    assert report["bindings"][0]["start_line"] == 8


def test_support_quotes_allow_whitespace_only_normalization(ledger: CitationLedger) -> None:
    ledger.add({"citation": "/projects/primary/tome/wiki/activity.md"}, "Approval is\n pending.", 12)
    _, report = render(ledger, "Approval is pending.", [supported(0, "source-2", "Approval is pending.")])
    assert report["bindings"][0]["start_line"] == 12
    assert report["bindings"][0]["end_line"] == 13


def test_unsupported_claim_is_disclosed_instead_of_emitted_as_fact(ledger: CitationLedger) -> None:
    output, report = render(ledger, "All milestones shipped.", [{"block_id": 0, "status": "gap", "supports": [],
        "reason": "No launch evidence was available."}])
    assert "All milestones shipped" not in output
    assert "Evidence gap" in output
    assert report["missing_evidence"] and not report["supporting_urls"]


def test_live_html_retains_machine_readable_dates() -> None:
    assert "2026-01-02" in live_plain_text('<time datetime="2026-01-02"/>')


def test_incomplete_live_reads_do_not_enter_citation_evidence() -> None:
    ledger = CitationLedger()
    ledger.add_live([{"url": LIVE, "body": "Milestone is ready.", "read_coverage": "partial"}])
    assert not ledger.sources


def test_review_excerpt_budget_is_explicit_and_bounded(ledger: CitationLedger) -> None:
    for index in range(50):
        ledger.add({"citation": f"/projects/primary/tome/wiki/{index}.md"}, "Example\n" * 2000)
    evidence = ledger.review_evidence("milestone", "ready", {WIKI})
    assert sum(len(part["text"]) for entry in evidence for part in entry["excerpts"]) <= MAX_REVIEW_CHARACTERS
    assert evidence[0]["reference"]["citation"] == WIKI


@pytest.mark.asyncio
async def test_one_bounded_repair_fixes_invalid_quotes(ledger: CitationLedger) -> None:
    def response(bindings: list[dict]) -> httpx.Response:
        return httpx.Response(200, request=httpx.Request("POST", "https://example.test/v1/messages"), json={
            "stop_reason": "end_turn", "content": [{"type": "text", "text": json.dumps({"blocks": bindings})}]})
    client = AsyncMock()
    client.post.side_effect = [response([supported(0, quote="Milestone launched.")]), response([supported(0)])]
    output, report = await ledger.cite(client, "https://example.test", {}, "example-model", "milestone",
        "Milestone is ready but awaiting approval.", set())
    assert client.post.await_count == 2
    assert report["status"] == "completed" and WIKI in output


@pytest.mark.asyncio
async def test_failed_review_withholds_draft(ledger: CitationLedger) -> None:
    client = AsyncMock()
    client.post.side_effect = httpx.ReadTimeout("example")
    output, report = await ledger.cite(client, "https://example.test", {}, "example-model", "milestone",
        "Milestone launched without a source.", set())
    assert "Milestone launched" not in output
    assert "withheld" in output and report["status"] == "incomplete"
    assert not report["supporting_urls"]
