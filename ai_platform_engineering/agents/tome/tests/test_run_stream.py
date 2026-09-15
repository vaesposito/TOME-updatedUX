import asyncio
import json
from types import SimpleNamespace
from typing import ClassVar
from unittest import TestCase
from unittest.mock import patch

from claude_agent_sdk import (
    AssistantMessage,
    ResultMessage,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from opentelemetry import context as context_api
from opentelemetry.instrumentation.utils import _SUPPRESS_INSTRUMENTATION_KEY

from tome_agent.agent.run_stream import (
    _tool_result_text,
    confluence_tree_coverage,
    consume_agent_query,
)


class ConfluenceCoverageTest(TestCase):
    def test_extracts_complete_tree_coverage_from_sdk_block(self) -> None:
        payload = {
            "root_page_id": "123",
            "page_fields": ["id", "title", "parent_id", "depth", "body"],
            "pages": [
                ["123", "Platform Engineering", None, 0, "Root body"],
                ["456", "Runbook", "123", 1, "Child body"],
                ["789", "Placeholder", "123", 1, ""],
            ],
            "tree_truncated": False,
        }
        block = ToolResultBlock(
            tool_use_id="tool-1",
            content=[{"type": "text", "text": json.dumps(payload)}],
        )

        coverage = confluence_tree_coverage(
            "mcp__confluence__confluence_get_page_tree",
            block.content,
        )

        self.assertEqual(
            coverage,
            {
                "root_title": "Platform Engineering",
                "total_pages": 3,
                "pages_with_content": 2,
                "tree_truncated": False,
            },
        )

    def test_ignores_other_tools_and_malformed_results(self) -> None:
        self.assertIsNone(confluence_tree_coverage("gh.github_list_issues", "{}"))
        self.assertIsNone(
            confluence_tree_coverage(
                "mcp__confluence__confluence_get_page_tree",
                "not json",
            )
        )

    def test_normalizes_string_and_list_content(self) -> None:
        self.assertEqual(_tool_result_text("plain"), "plain")
        self.assertEqual(
            _tool_result_text(
                [
                    {"type": "text", "text": "first"},
                    {"type": "image", "data": "..."},
                    {"type": "text", "text": " second"},
                ]
            ),
            "first second",
        )


class RestrictedEvidenceRunStreamTest(TestCase):
    def test_restricted_pass_suppresses_sdk_telemetry_and_run_log_content(self) -> None:
        secret = "myagent-evidence-must-not-reach-telemetry-or-logs"

        class FakeClient:
            instances: ClassVar[list["FakeClient"]] = []

            def __init__(self, *, options) -> None:
                self.options = options
                self.suppressed_during_query = False
                self.suppressed_during_receive = False
                self.__class__.instances.append(self)

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args) -> bool:
                return False

            async def query(self, _prompt: str) -> None:
                self.suppressed_during_query = bool(
                    context_api.get_value(_SUPPRESS_INSTRUMENTATION_KEY)
                )

            async def receive_response(self):
                self.suppressed_during_receive = bool(
                    context_api.get_value(_SUPPRESS_INSTRUMENTATION_KEY)
                )
                yield AssistantMessage(
                    content=[
                        ToolUseBlock(
                            id="tool-1",
                            name="Write",
                            input={"file_path": "overview.md", "content": secret},
                        ),
                        TextBlock(text=f"Model summary repeats {secret}"),
                    ],
                    model="claude-test",
                )
                yield UserMessage(
                    content=[
                        ToolResultBlock(
                            tool_use_id="tool-1",
                            content=f"tool response repeats {secret}",
                        )
                    ]
                )
                yield ResultMessage(
                    subtype="success",
                    duration_ms=1,
                    duration_api_ms=1,
                    is_error=False,
                    num_turns=1,
                    session_id="session-1",
                    result=secret,
                )

        async def collect():
            return [
                event
                async for event in consume_agent_query(
                    "sensitive prompt",
                    SimpleNamespace(model="claude-test"),
                    [],
                    redact_sensitive_content=True,
                )
            ]

        with patch("tome_agent.agent.run_stream.ClaudeSDKClient", FakeClient):
            events = asyncio.run(collect())

        self.assertTrue(FakeClient.instances[0].suppressed_during_query)
        self.assertTrue(FakeClient.instances[0].suppressed_during_receive)
        encoded = json.dumps([event.model_dump() for event in events])
        self.assertNotIn(secret, encoded)
        self.assertIn("[input suppressed]", encoded)
        self.assertIn("[assistant text suppressed]", encoded)
