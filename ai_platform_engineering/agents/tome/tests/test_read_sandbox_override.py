import asyncio
from pathlib import Path
from unittest import TestCase

from tome_agent.agent.loop import (
    READ_SANDBOX_OVERRIDE_MARKER,
    make_constrain_reads_hook,
)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class ConstrainReadsHookTest(TestCase):
    def setUp(self) -> None:
        self.project_dir = Path("/project/proj-1")
        self.hook = make_constrain_reads_hook(self.project_dir)

    def test_read_inside_project_dir_is_allowed_silently(self) -> None:
        result = _run(
            self.hook(
                {
                    "tool_name": "Read",
                    "tool_input": {"file_path": "/project/proj-1/overview.md"},
                },
                "id",
                {},
            )
        )
        self.assertEqual(result, {})

    def test_read_outside_project_dir_is_denied_with_override_instructions(
        self,
    ) -> None:
        result = _run(
            self.hook(
                {"tool_name": "Read", "tool_input": {"file_path": "/etc/passwd"}},
                "id",
                {},
            )
        )
        output = result["hookSpecificOutput"]
        self.assertEqual(output["permissionDecision"], "deny")
        self.assertIn(READ_SANDBOX_OVERRIDE_MARKER, output["permissionDecisionReason"])
        self.assertIn("/etc/passwd", output["permissionDecisionReason"])

    def test_marker_prefixed_path_is_allowed_and_stripped(self) -> None:
        real_path = "/home/agent/.claude/projects/x/tool-results/big.txt"
        result = _run(
            self.hook(
                {
                    "tool_name": "Read",
                    "tool_input": {
                        "file_path": f"{READ_SANDBOX_OVERRIDE_MARKER}{real_path}"
                    },
                },
                "id",
                {},
            )
        )
        output = result["hookSpecificOutput"]
        self.assertEqual(output["permissionDecision"], "allow")
        self.assertEqual(output["updatedInput"]["file_path"], real_path)

    def test_marker_works_on_glob_grep_path_key_too(self) -> None:
        real_path = "/tmp/somewhere"
        result = _run(
            self.hook(
                {
                    "tool_name": "Grep",
                    "tool_input": {
                        "path": f"{READ_SANDBOX_OVERRIDE_MARKER}{real_path}",
                        "pattern": "x",
                    },
                },
                "id",
                {},
            )
        )
        output = result["hookSpecificOutput"]
        self.assertEqual(output["permissionDecision"], "allow")
        self.assertEqual(output["updatedInput"]["path"], real_path)
        self.assertEqual(output["updatedInput"]["pattern"], "x")

    def test_restricted_mode_never_teaches_or_honors_the_override_marker(self) -> None:
        restricted_hook = make_constrain_reads_hook(
            self.project_dir,
            allow_override=False,
        )
        result = _run(
            restricted_hook(
                {
                    "tool_name": "Read",
                    "tool_input": {
                        "file_path": f"{READ_SANDBOX_OVERRIDE_MARKER}/proc/self/environ"
                    },
                },
                "id",
                {},
            )
        )
        output = result["hookSpecificOutput"]
        self.assertEqual(output["permissionDecision"], "deny")
        self.assertNotIn(
            READ_SANDBOX_OVERRIDE_MARKER, output["permissionDecisionReason"]
        )

    def test_glob_with_no_path_defaults_to_cwd_and_is_allowed(self) -> None:
        result = _run(
            self.hook(
                {"tool_name": "Glob", "tool_input": {"pattern": "**/*.md"}}, "id", {}
            )
        )
        self.assertEqual(result, {})

    def test_restricted_glob_binds_a_safe_relative_pattern_to_project_root(
        self,
    ) -> None:
        restricted_hook = make_constrain_reads_hook(
            self.project_dir,
            allow_override=False,
        )
        result = _run(
            restricted_hook(
                {"tool_name": "Glob", "tool_input": {"pattern": "**/*.md"}},
                "id",
                {},
            )
        )
        output = result["hookSpecificOutput"]
        self.assertEqual(output["permissionDecision"], "allow")
        self.assertEqual(output["updatedInput"]["path"], str(self.project_dir))

    def test_restricted_glob_rejects_absolute_and_parent_patterns_without_path(
        self,
    ) -> None:
        restricted_hook = make_constrain_reads_hook(
            self.project_dir,
            allow_override=False,
        )
        for pattern in (
            "/etc/**/*.md",
            "../other-project/**/*.md",
            "..\\other-project\\*.md",
            "~other-user/**/*.md",
            # Bun.Glob has treated `.*` as matching `..` in some versions;
            # a dot-leading wildcard must not escape the restricted root.
            ".*/*",
        ):
            result = _run(
                restricted_hook(
                    {"tool_name": "Glob", "tool_input": {"pattern": pattern}},
                    "id",
                    {},
                )
            )
            output = result["hookSpecificOutput"]
            self.assertEqual(output["permissionDecision"], "deny")
            self.assertNotIn(pattern, output["permissionDecisionReason"])

    def test_restricted_glob_rejects_unsafe_pattern_with_an_explicit_safe_path(
        self,
    ) -> None:
        restricted_hook = make_constrain_reads_hook(
            self.project_dir,
            allow_override=False,
        )
        result = _run(
            restricted_hook(
                {
                    "tool_name": "Glob",
                    "tool_input": {
                        "path": str(self.project_dir),
                        "pattern": "../outside/*.md",
                    },
                },
                "id",
                {},
            )
        )
        self.assertEqual(
            result["hookSpecificOutput"]["permissionDecision"],
            "deny",
        )

    def test_restricted_grep_binds_default_path_and_rejects_unsafe_filename_glob(
        self,
    ) -> None:
        restricted_hook = make_constrain_reads_hook(
            self.project_dir,
            allow_override=False,
        )
        safe = _run(
            restricted_hook(
                {
                    "tool_name": "Grep",
                    "tool_input": {"pattern": "risk", "glob": "*.md"},
                },
                "id",
                {},
            )
        )
        self.assertEqual(
            safe["hookSpecificOutput"]["updatedInput"]["path"],
            str(self.project_dir),
        )

        unsafe = _run(
            restricted_hook(
                {
                    "tool_name": "Grep",
                    "tool_input": {"pattern": "risk", "glob": "../*.md"},
                },
                "id",
                {},
            )
        )
        self.assertEqual(
            unsafe["hookSpecificOutput"]["permissionDecision"],
            "deny",
        )

        dot_wildcard = _run(
            restricted_hook(
                {
                    "tool_name": "Grep",
                    "tool_input": {"pattern": "risk", "glob": ".*/*"},
                },
                "id",
                {},
            )
        )
        self.assertEqual(
            dot_wildcard["hookSpecificOutput"]["permissionDecision"],
            "deny",
        )

    def test_notebook_read_uses_its_native_path_field_for_the_read_fence(self) -> None:
        result = _run(
            self.hook(
                {
                    "tool_name": "NotebookRead",
                    "tool_input": {"notebook_path": "/etc/private.ipynb"},
                },
                "id",
                {},
            )
        )
        self.assertEqual(
            result["hookSpecificOutput"]["permissionDecision"],
            "deny",
        )

    def test_non_read_tool_is_ignored(self) -> None:
        result = _run(
            self.hook(
                {"tool_name": "Bash", "tool_input": {"command": "cat /etc/passwd"}},
                "id",
                {},
            )
        )
        self.assertEqual(result, {})
