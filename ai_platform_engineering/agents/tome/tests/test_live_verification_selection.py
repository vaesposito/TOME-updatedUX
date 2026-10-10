from types import SimpleNamespace
from typing import cast

from tome_agent.agent.retrieval import _verification_pages
from tome_agent.agent.retrieval_context import PublishedCorpus


def test_live_verification_uses_retrieved_pages_without_citations() -> None:
    relevant = ("example-project", "launch.md")
    unrelated = ("another-project", "overview.md")
    corpus = cast(PublishedCorpus, SimpleNamespace(pages={
        relevant: SimpleNamespace(reference=lambda: {"citation": "/example/launch"}),
        unrelated: SimpleNamespace(reference=lambda: {"citation": "/another/overview"}),
    }))

    assert _verification_pages({relevant, unrelated}, {relevant}, set(), corpus) == [relevant]


def test_live_verification_prioritizes_cited_pages() -> None:
    relevant = ("example-project", "launch.md")
    other = ("another-project", "overview.md")
    corpus = cast(PublishedCorpus, SimpleNamespace(pages={
        relevant: SimpleNamespace(reference=lambda: {"citation": "/example/launch"}),
        other: SimpleNamespace(reference=lambda: {"citation": "/another/overview"}),
    }))

    assert _verification_pages({relevant, other}, {relevant, other}, {"/example/launch"}, corpus) == [relevant]


def test_live_verification_accepts_upstream_citations_from_preloaded_evidence() -> None:
    relevant = ("example-project", "launch.md")
    unrelated = ("another-project", "overview.md")
    corpus = cast(PublishedCorpus, SimpleNamespace(pages={
        relevant: SimpleNamespace(reference=lambda: {"citation": "/example/launch"}),
        unrelated: SimpleNamespace(reference=lambda: {"citation": "/another/overview"}),
    }))
    assert _verification_pages({relevant, unrelated}, {relevant, unrelated},
        {"/wiki/pages/123"}, corpus, {relevant}) == [relevant]
