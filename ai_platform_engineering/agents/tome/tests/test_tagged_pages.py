"""Pages tagged into this space from elsewhere: contract and prompt rendering."""

from __future__ import annotations

from tome_agent.agent.chat import build_system_prompt
from tome_agent.agent.loop import project_root
from tome_agent.orchestrator.contract import (
    ChatRequest,
    ChildProjectSnapshot,
    ProjectSnapshot,
    TaggedPage,
)


def _snapshot(**overrides: object) -> ProjectSnapshot:
    return ProjectSnapshot(
        project_id="project-primary",
        slug="primary",
        name="Primary project",
        **overrides,
    )


def _page(**overrides: object) -> TaggedPage:
    return TaggedPage(
        **{
            "space_slug": "secondary",
            "space_title": "Secondary space",
            "path": "notes/rollout.md",
            "title": "Rollout notes",
            "whole_page": True,
            "markdown": "# Rollout notes\n\nThe cutover window is still open.",
            **overrides,
        }
    )


def _chat_request_body(**overrides: object) -> dict[str, object]:
    return {
        "message": "What did the other space say about the rollout?",
        "snapshot": _snapshot().model_dump(),
        **overrides,
    }


class TestContract:
    def test_tagged_pages_survive_parsing(self) -> None:
        body = _chat_request_body(
            tagged_pages=[
                {
                    "space_slug": "secondary",
                    "space_title": "Secondary space",
                    "path": "notes/rollout.md",
                    "title": "Rollout notes",
                    "whole_page": False,
                    "markdown": "A tagged passage.",
                }
            ]
        )

        request = ChatRequest.model_validate(body)

        assert len(request.tagged_pages) == 1
        page = request.tagged_pages[0]
        assert page.space_slug == "secondary"
        assert page.space_title == "Secondary space"
        assert page.path == "notes/rollout.md"
        assert page.title == "Rollout notes"
        assert page.whole_page is False
        assert page.markdown == "A tagged passage."

    def test_request_without_tagged_pages_still_parses(self) -> None:
        request = ChatRequest.model_validate(_chat_request_body())

        assert request.tagged_pages == []

    def test_empty_tagged_pages_list_is_accepted(self) -> None:
        request = ChatRequest.model_validate(_chat_request_body(tagged_pages=[]))

        assert request.tagged_pages == []


class TestPromptRendering:
    def test_prompt_names_the_owning_space_and_carries_the_body(self) -> None:
        prompt = build_system_prompt(_snapshot(), {}, None, [_page()])

        assert "TAGGED PAGES" in prompt
        assert 'space="Secondary space"' in prompt
        assert 'space_slug="secondary"' in prompt
        assert 'path="notes/rollout.md"' in prompt
        assert "The cutover window is still open." in prompt

    def test_prompt_marks_tagged_pages_read_only_and_keeps_the_write_root(self) -> None:
        prompt = build_system_prompt(_snapshot(), {}, None, [_page()])

        tagged_section = prompt.split("TAGGED PAGES", 1)[1]
        assert "READ-ONLY" in tagged_section
        assert "NEVER write to them" in tagged_section
        # The project's own root is restated as the single write target, and
        # the tagged page's space is never offered as somewhere to write.
        assert str(project_root("project-primary")) in tagged_section
        assert str(project_root("secondary")) not in prompt

    def test_passage_tags_are_distinguished_from_whole_page_tags(self) -> None:
        prompt = build_system_prompt(_snapshot(), {}, None, [_page(whole_page=False)])

        assert 'tagged="tagged passages"' in prompt
        assert 'tagged="whole page"' not in prompt

    def test_a_plain_project_is_not_described_as_a_roll_up(self) -> None:
        prompt = build_system_prompt(_snapshot(), {}, None, [_page()])

        assert "CHILD PROJECT WIKIS" not in prompt
        assert "BHAG" not in prompt.split("TAGGED PAGES", 1)[1]

    def test_child_project_wikis_and_tagged_pages_stay_separate_sections(self) -> None:
        snapshot = _snapshot(
            project_type="bhag",
            child_projects=[
                ChildProjectSnapshot(project_id="project-secondary", name="Secondary project")
            ],
        )

        prompt = build_system_prompt(snapshot, {}, None, [_page()])

        assert "CHILD PROJECT WIKIS" in prompt
        assert prompt.index("CHILD PROJECT WIKIS") < prompt.index("TAGGED PAGES")
        assert "project-secondary" not in prompt.split("TAGGED PAGES", 1)[1]

    def test_no_tagged_pages_renders_no_section(self) -> None:
        assert "TAGGED PAGES" not in build_system_prompt(_snapshot(), {}, None, [])
        assert "TAGGED PAGES" not in build_system_prompt(_snapshot(), {}, None, None)
        assert "TAGGED PAGES" not in build_system_prompt(_snapshot(), {})

    def test_page_metadata_is_escaped_into_the_attributes(self) -> None:
        prompt = build_system_prompt(
            _snapshot(), {}, None, [_page(title='Rollout "phase two"')]
        )

        assert 'title="Rollout &quot;phase two&quot;"' in prompt
