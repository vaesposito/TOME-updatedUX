import asyncio
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import ClassVar
from unittest import TestCase
from unittest.mock import patch

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    CLIJSONDecodeError,
    ResultMessage,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from claude_agent_sdk._internal.transport.subprocess_cli import SubprocessCLITransport
from opentelemetry import context as context_api
from opentelemetry.instrumentation.utils import _SUPPRESS_INSTRUMENTATION_KEY

from tome_agent.agent.run_stream import (
    _file_backed_system_prompt,
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
    def test_restricted_failures_are_classified_without_leaking_content(self) -> None:
        secret = "source-evidence-must-not-reach-logs"
        cases = [
            (
                CLIJSONDecodeError(
                    "JSON message exceeded maximum buffer size of 67108864 bytes",
                    ValueError(secret),
                ),
                "Agent SDK message buffer limit exceeded",
            ),
            (CLIJSONDecodeError(secret, ValueError(secret)), "restricted evidence agent stream failed"),
            (RuntimeError(secret), "restricted evidence agent stream failed"),
        ]
        for failure, expected in cases:
            with self.subTest(expected=expected, exception=type(failure).__name__):
                class FakeClient:
                    def __init__(self, *, options, failure=failure):
                        self.options = options
                        self.failure = failure

                    async def __aenter__(self):
                        return self

                    async def __aexit__(self, *_args):
                        return False

                    async def query(self, _prompt):
                        pass

                    async def receive_response(self):
                        raise self.failure
                        if False:
                            yield None

                async def collect():
                    return [
                        event async for event in consume_agent_query(
                            secret, SimpleNamespace(model="claude-test"), [],
                            redact_sensitive_content=True,
                        )
                    ]

                with (
                    patch("tome_agent.agent.run_stream.ClaudeSDKClient", FakeClient),
                    self.assertLogs("tome_agent.agent.run_stream", level="WARNING") as logs,
                ):
                    events = asyncio.run(collect())
                encoded = json.dumps([event.model_dump() for event in events])
                self.assertNotIn(secret, encoded)
                self.assertNotIn(secret, "\n".join(logs.output))
                self.assertEqual(events[-1].type, "error")
                self.assertIn(expected, events[-1].data["message"])

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


class FileBackedPromptTest(TestCase):
    def test_large_utf8_prompt_is_complete_private_and_removed(self) -> None:
        # Exceeds Linux's per-argument limit even though the character count
        # is smaller. The SDK must pass only the path to the child process.
        prompt = "Meeting transcript: " + "é" * 90_000
        options = ClaudeAgentOptions(system_prompt=prompt, model="example-model")
        with _file_backed_system_prompt(options) as file_options:
            self.assertEqual(options.system_prompt, prompt)
            self.assertIsNot(options, file_options)
            path = Path(file_options.system_prompt["path"])
            self.assertEqual(path.read_bytes(), prompt.encode("utf-8"))
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            # Exercise the installed SDK's actual command builder, without
            # invoking a model or making any network calls.
            transport = SubprocessCLITransport(prompt="Ingest", options=file_options)
            transport._cli_path = "/bin/true"
            command = transport._build_command()
            self.assertIn("--system-prompt-file", command)
            self.assertNotIn("--system-prompt", command)
            self.assertNotIn(prompt, command)
            self.assertEqual(command[command.index("--system-prompt-file") + 1], str(path))
            subprocess.run(["/bin/true", *command], check=True)
        self.assertFalse(path.exists())

    def test_cleanup_on_failure_and_concurrent_prompts_are_isolated(self) -> None:
        first = ClaudeAgentOptions(system_prompt="first")
        second = ClaudeAgentOptions(system_prompt="second")
        with (
            self.assertRaisesRegex(RuntimeError, "startup failed"),
            _file_backed_system_prompt(first) as a,
            _file_backed_system_prompt(second) as b,
        ):
            first_path = Path(a.system_prompt["path"])
            second_path = Path(b.system_prompt["path"])
            self.assertNotEqual(first_path, second_path)
            self.assertEqual(first_path.read_text(), "first")
            self.assertEqual(second_path.read_text(), "second")
            raise RuntimeError("startup failed")
        self.assertFalse(first_path.exists())
        self.assertFalse(second_path.exists())

    def test_existing_file_or_preset_options_are_unchanged(self) -> None:
        for prompt in (None, {"type": "preset", "preset": "claude_code"}, {"type": "file", "path": "/tmp/example.txt"}):
            options = ClaudeAgentOptions(system_prompt=prompt)
            with _file_backed_system_prompt(options) as transported:
                self.assertIs(transported, options)


class TerminalResultTest(TestCase):
    def collect(self, messages: list, *, startup_error: bool = False) -> list:
        class FakeClient:
            def __init__(self, *, options) -> None:
                self.options = options

            async def __aenter__(self):
                if startup_error:
                    raise OSError(7, "Argument list too long")
                return self

            async def __aexit__(self, *_args) -> bool:
                return False

            async def query(self, _prompt: str) -> None:
                pass

            async def receive_response(self):
                for message in messages:
                    yield message

        async def collect():
            return [event async for event in consume_agent_query(
                "Ingest", ClaudeAgentOptions(system_prompt="test", model="example-model"), []
            )]

        with patch("tome_agent.agent.run_stream.ClaudeSDKClient", FakeClient):
            return asyncio.run(collect())

    def test_startup_failure_is_not_a_successful_result(self) -> None:
        events = self.collect([], startup_error=True)
        self.assertEqual([event.type for event in events], ["error"])
        self.assertIn("Argument list too long", events[0].data["message"])

    def test_eof_without_sdk_result_is_an_error(self) -> None:
        events = self.collect([])
        self.assertEqual([event.type for event in events], ["error"])
        self.assertIn("without a completion result", events[0].data["message"])

    def test_failed_results_preserve_accounting_but_are_not_successful(self) -> None:
        for subtype, is_error in (("success", False), ("success", True), ("error_max_turns", False), ("error_during_execution", True)):
            result = ResultMessage(
                subtype=subtype, duration_ms=1, duration_api_ms=1,
                is_error=is_error, num_turns=2, session_id="example-session", total_cost_usd=0.1,
            )
            events = self.collect([result])
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0].type, "done")
            self.assertEqual(events[0].data["is_error"], is_error or subtype != "success")
            self.assertEqual(events[0].data["cost_usd"], 0.1)

    def test_cancellation_cleans_up_prompt_file(self) -> None:
        paths: list[Path] = []

        class WaitingClient:
            def __init__(self, *, options) -> None:
                paths.append(Path(options.system_prompt["path"]))

            async def __aenter__(self):
                raise asyncio.CancelledError()

            async def __aexit__(self, *_args) -> bool:
                return False

        async def collect():
            return [event async for event in consume_agent_query(
                "Ingest", ClaudeAgentOptions(system_prompt="private transcript"), []
            )]

        with (
            patch("tome_agent.agent.run_stream.ClaudeSDKClient", WaitingClient),
            self.assertRaises(asyncio.CancelledError),
        ):
            asyncio.run(collect())
        self.assertEqual(len(paths), 1)
        self.assertFalse(paths[0].exists())
