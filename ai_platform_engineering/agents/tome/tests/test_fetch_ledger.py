"""Source-fetch provenance ledger: the shared recording point in
connectors/base.py, and the canonical-uri/redaction builders each connector
registers with it.

See docs/docs/specs/2026-09-28-tome-source-fetch-ledger/.
"""

from __future__ import annotations

import hashlib
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

from tome_agent.agent import http_client
from tome_agent.agent.connectors.base import record_fetch, redact_tool_args
from tome_agent.agent.mcp_confluence import _confluence_canonical_uri
from tome_agent.agent.mcp_github import _github_canonical_uri
from tome_agent.agent.mcp_webex import _webex_canonical_uri
from tome_agent.orchestrator.contract import AppendFetchLedgerEntryRequest


def _ok(payload: str) -> dict:
    return {"content": [{"type": "text", "text": payload}]}


def _err(message: str) -> dict:
    return {"content": [{"type": "text", "text": message}], "is_error": True}


class FetchLedgerRecordingTest(IsolatedAsyncioTestCase):
    """Exercises `record_fetch` directly against stub tool functions — the
    same shape every mcp_*.py tool implementation has (`async def
    fn(args) -> dict`)."""

    def setUp(self) -> None:
        self.run_id: UUID = uuid4()

    def tearDown(self) -> None:
        # ContextVar state outlives the test's event loop; reset explicitly
        # so other tests in this process never see a leftover run id.
        http_client.set_active_run_id(None)

    def _decorated(
        self,
        fn,
        *,
        connector: str = "stub",
        tool_name: str = "stub_tool",
        allowed_arg_keys: frozenset[str] = frozenset({"id"}),
        canonical_uri=lambda tool_name, args: f"stub://{args.get('id', 'unknown')}",
    ):
        return record_fetch(
            connector=connector,
            tool_name=tool_name,
            allowed_arg_keys=allowed_arg_keys,
            canonical_uri=canonical_uri,
        )(fn)

    async def test_success_produces_entry_with_matching_hash(self) -> None:
        http_client.set_active_run_id(self.run_id)
        captured: list[tuple[UUID, AppendFetchLedgerEntryRequest]] = []

        async def fake_append(run_id, entry):
            captured.append((run_id, entry))

        async def tool(args: dict) -> dict:
            return _ok("the exact bytes returned to the agent")

        wrapped = self._decorated(tool, tool_name="stub_get", canonical_uri=lambda t, a: "stub://item/1")

        with patch.object(http_client, "append_fetch_ledger_entry", new=fake_append):
            result = await wrapped({"id": "1"})

        self.assertEqual(result, _ok("the exact bytes returned to the agent"))
        self.assertEqual(len(captured), 1)
        run_id, entry = captured[0]
        self.assertEqual(run_id, self.run_id)
        self.assertEqual(entry.status, "success")
        self.assertEqual(entry.canonical_uri, "stub://item/1")
        self.assertEqual(entry.content, "the exact bytes returned to the agent")
        self.assertEqual(
            entry.content_hash,
            hashlib.sha256(b"the exact bytes returned to the agent").hexdigest(),
        )
        self.assertIsNone(entry.error_message)

    async def test_error_result_produces_entry_without_content_or_hash(self) -> None:
        http_client.set_active_run_id(self.run_id)
        captured: list[AppendFetchLedgerEntryRequest] = []

        async def fake_append(run_id, entry):
            captured.append(entry)

        async def tool(args: dict) -> dict:
            return _err("HTTP 404: not found")

        wrapped = self._decorated(tool, tool_name="stub_get")

        with patch.object(http_client, "append_fetch_ledger_entry", new=fake_append):
            result = await wrapped({"id": "missing"})

        self.assertTrue(result.get("is_error"))
        self.assertEqual(len(captured), 1)
        entry = captured[0]
        self.assertEqual(entry.status, "error")
        self.assertIsNone(entry.content)
        self.assertIsNone(entry.content_hash)
        self.assertEqual(entry.error_message, "HTTP 404: not found")

    async def test_no_active_run_id_skips_recording_entirely(self) -> None:
        # No set_active_run_id() call — matches a chat turn, which has no
        # Run Ledger concept.
        fake_append = AsyncMock()

        async def tool(args: dict) -> dict:
            return _ok("content")

        wrapped = self._decorated(tool)

        with patch.object(http_client, "append_fetch_ledger_entry", new=fake_append):
            result = await wrapped({"id": "1"})

        self.assertEqual(result, _ok("content"))
        fake_append.assert_not_called()

    async def test_callback_failure_is_swallowed_and_never_changes_tool_result(self) -> None:
        http_client.set_active_run_id(self.run_id)

        async def failing_append(run_id, entry):
            raise RuntimeError("backend unreachable")

        async def tool(args: dict) -> dict:
            return _ok("content")

        wrapped = self._decorated(tool)

        with patch.object(http_client, "append_fetch_ledger_entry", new=failing_append):
            result = await wrapped({"id": "1"})  # must not raise

        self.assertEqual(result, _ok("content"))

    async def test_redacts_non_allowlisted_args_but_keeps_identifiers(self) -> None:
        http_client.set_active_run_id(self.run_id)
        captured: list[AppendFetchLedgerEntryRequest] = []

        async def fake_append(run_id, entry):
            captured.append(entry)

        async def tool(args: dict) -> dict:
            return _ok("content")

        wrapped = self._decorated(
            tool,
            tool_name="stub_search",
            allowed_arg_keys=frozenset({"id"}),
            canonical_uri=lambda t, a: "stub://search",
        )

        with patch.object(http_client, "append_fetch_ledger_entry", new=fake_append):
            await wrapped({"id": "1", "query": "sensitive search terms"})

        entry = captured[0]
        self.assertEqual(entry.tool_args["id"], "1")
        self.assertNotIn("sensitive search terms", str(entry.tool_args["query"]))
        self.assertIn("redacted", entry.tool_args["query"])

    async def test_repeated_calls_in_one_run_produce_independent_entries(self) -> None:
        """Edge case: the same content fetched twice in a run is logged as
        two separate ledger entries, not deduplicated."""
        http_client.set_active_run_id(self.run_id)
        captured: list[AppendFetchLedgerEntryRequest] = []

        async def fake_append(run_id, entry):
            captured.append(entry)

        async def tool(args: dict) -> dict:
            return _ok("same content both times")

        wrapped = self._decorated(tool, tool_name="stub_get", canonical_uri=lambda t, a: "stub://same-item")

        with patch.object(http_client, "append_fetch_ledger_entry", new=fake_append):
            await wrapped({"id": "1"})
            await wrapped({"id": "1"})

        self.assertEqual(len(captured), 2)
        self.assertEqual(captured[0].content_hash, captured[1].content_hash)
        self.assertIsNot(captured[0], captured[1])

    async def test_new_connector_gets_ledger_coverage_with_no_ledger_specific_code(self) -> None:
        """SC-003: a minimal stand-in for a not-yet-existing connector, whose
        only ledger-related code is the `record_fetch` decoration itself —
        proving the guarantee is enforced at the shared boundary, not by each
        connector remembering to log."""
        http_client.set_active_run_id(self.run_id)
        fake_append = AsyncMock()

        @record_fetch(
            connector="hypothetical_future_connector",
            tool_name="hypothetical_future_connector_get_item",
            allowed_arg_keys=frozenset({"item_id"}),
            canonical_uri=lambda t, a: f"hypothetical://{a['item_id']}",
        )
        async def get_item(args: dict) -> dict:
            return _ok(f"item {args['item_id']}")

        with patch.object(http_client, "append_fetch_ledger_entry", new=fake_append):
            await get_item({"item_id": "42"})

        fake_append.assert_awaited_once()
        _, entry = fake_append.call_args.args
        self.assertEqual(entry.connector, "hypothetical_future_connector")
        self.assertEqual(entry.canonical_uri, "hypothetical://42")


class RedactToolArgsTest(IsolatedAsyncioTestCase):
    async def test_keeps_allowed_keys_verbatim_and_redacts_the_rest(self) -> None:
        result = redact_tool_args(
            {"repo": "org/repo", "query": "some free text"},
            frozenset({"repo"}),
        )
        self.assertEqual(result["repo"], "org/repo")
        self.assertNotEqual(result["query"], "some free text")
        self.assertIn("redacted", result["query"])
        self.assertIn(str(len("some free text")), result["query"])

    async def test_handles_none_values(self) -> None:
        result = redact_tool_args({"since": None}, frozenset())
        self.assertIn("redacted", result["since"])


class GithubCanonicalUriTest(IsolatedAsyncioTestCase):
    async def test_file_read_uses_blob_scheme(self) -> None:
        uri = _github_canonical_uri(
            "github_get_file", {"repo": "org/repo", "path": "README.md", "ref": "main"}
        )
        self.assertEqual(uri, "github://org/repo/blob/main/README.md")

    async def test_issue_uses_issue_number(self) -> None:
        uri = _github_canonical_uri("github_get_issue", {"repo": "org/repo", "number": 42})
        self.assertEqual(uri, "github://org/repo/issues/42")

    async def test_list_dir_uses_tree_scheme_not_blob(self) -> None:
        uri = _github_canonical_uri(
            "github_list_dir", {"repo": "org/repo", "path": "src", "ref": ""}
        )
        self.assertEqual(uri, "github://org/repo/tree/HEAD/src")

    async def test_search_issues_hashes_query_instead_of_embedding_it(self) -> None:
        uri = _github_canonical_uri("github_search_issues", {"query": "sensitive terms"})
        self.assertTrue(uri.startswith("github://search/issues?q_hash="))
        self.assertNotIn("sensitive terms", uri)

    async def test_list_commits_is_repo_scoped(self) -> None:
        uri = _github_canonical_uri("github_list_commits", {"repo": "org/repo", "since": "x"})
        self.assertEqual(uri, "github://org/repo/commits")


class ConfluenceCanonicalUriTest(IsolatedAsyncioTestCase):
    async def test_page_id_takes_precedence(self) -> None:
        uri = _confluence_canonical_uri(
            "confluence_get_page_content", {"page_id": "123", "space_key": "ENG"}
        )
        self.assertEqual(uri, "confluence://pages/123")

    async def test_space_only_falls_back_to_space_scope(self) -> None:
        uri = _confluence_canonical_uri("confluence_get_pages", {"space_key": "ENG"})
        self.assertEqual(uri, "confluence://spaces/ENG")

    async def test_no_args_falls_back_to_spaces_listing(self) -> None:
        uri = _confluence_canonical_uri("confluence_list_spaces", {})
        self.assertEqual(uri, "confluence://spaces")


class WebexCanonicalUriTest(IsolatedAsyncioTestCase):
    async def test_room_scoped_call(self) -> None:
        uri = _webex_canonical_uri("webex_list_messages", {"roomId": "room-1"})
        self.assertEqual(uri, "webex://rooms/room-1")

    async def test_message_scoped_call(self) -> None:
        uri = _webex_canonical_uri("webex_get_message", {"messageId": "msg-1"})
        self.assertEqual(uri, "webex://messages/msg-1")

    async def test_no_identifying_args_falls_back_to_tool_name(self) -> None:
        uri = _webex_canonical_uri("webex_meetings_list_meetings", {"state": "active"})
        self.assertEqual(uri, "webex://meetings_list_meetings")
