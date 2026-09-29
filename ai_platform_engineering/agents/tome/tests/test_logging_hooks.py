from unittest import IsolatedAsyncioTestCase

from tome_agent.agent.loop import (
    log_post_tool,
    log_pre_tool,
    make_deny_unsafe_tools_hook,
)


class LoggingHookTest(IsolatedAsyncioTestCase):
    async def test_pre_tool_hook_returns_sdk_compatible_output(self) -> None:
        result = await log_pre_tool(
            {"tool_name": "Read", "tool_input": {"file_path": "overview.md"}},
            "tool-1",
            {"signal": None},
        )

        self.assertEqual(result, {})

    async def test_post_tool_hook_returns_sdk_compatible_output(self) -> None:
        result = await log_post_tool(
            {
                "tool_name": "Read",
                "result": "page contents",
                "is_error": False,
            },
            "tool-1",
            {"signal": None},
        )

        self.assertEqual(result, {})

    async def test_restricted_tool_logs_do_not_include_inputs_or_outputs(self) -> None:
        secret = "delegated-evidence-should-not-be-logged"

        with self.assertLogs("tome_agent.agent.loop", level="INFO") as captured:
            await log_pre_tool(
                {"tool_name": "Write", "tool_input": {"content": secret}},
                "tool-1",
                {"session_id": secret},
                redact_sensitive_content=True,
            )
            await log_post_tool(
                {"tool_name": "Read", "result": secret, "is_error": False},
                "tool-1",
                {"session_id": secret},
                redact_sensitive_content=True,
            )

        output = "\n".join(captured.output)
        self.assertNotIn(secret, output)
        self.assertIn("arguments suppressed", output)
        self.assertIn("Result: [suppressed]", output)

    async def test_restricted_tool_deny_log_does_not_include_tool_input(self) -> None:
        secret = "delegated-evidence-in-denied-command"
        deny = make_deny_unsafe_tools_hook(redact_sensitive_content=True)

        with self.assertLogs("tome_agent.agent.loop", level="WARNING") as captured:
            result = await deny(
                {"tool_name": "Bash", "tool_input": {"command": secret}},
                "tool-1",
                {},
            )

        self.assertEqual(result["hookSpecificOutput"]["permissionDecision"], "deny")
        self.assertNotIn(secret, "\n".join(captured.output))
