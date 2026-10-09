"""Fetch failures, pagination and table fidelity cannot masquerade as freshness."""

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from common.models.rag import DataSourceInfo
from ingestors.confluence.loader import ConfluenceLoader


def make_loader() -> ConfluenceLoader:
  datasource = DataSourceInfo(
    datasource_id="source-example", ingestor_id="confluence:example",
    source_type="confluence", last_updated=None, default_chunk_size=1000, default_chunk_overlap=200,
  )
  return ConfluenceLoader(
    MagicMock(), MagicMock(), datasource, "https://example.test/wiki",
    "test-user@example.test", "example-token", True, 2,
  )


def page(page_id: str, body: Any = "<p>Example</p>") -> dict[str, Any]:
  return {"id": page_id, "title": "Example", "body": {"storage": {"value": body}}}


def response(payload: Any, status: int = 200) -> MagicMock:
  result = MagicMock()
  result.status = status
  result.json = AsyncMock(return_value=payload)
  result.__aenter__ = AsyncMock(return_value=result)
  result.__aexit__ = AsyncMock(return_value=None)
  return result


@pytest.mark.asyncio
async def test_short_batch_with_cursor_fetches_remaining_pages() -> None:
  loader = make_loader()
  loader.session = MagicMock()
  loader.session.get.side_effect = [
    response({"results": [{"content": page("123")}], "_links": {"next": "/wiki/rest/api/search?cursor=next%2Bvalue"}}),
    response({"results": [{"content": page("456")}]}),
  ]
  pages, failed = await loader.load_pages("EXAMPLE", page_limit=100)
  assert [item["id"] for item in pages] == ["123", "456"]
  assert failed == []
  assert loader.session.get.call_args_list[1].kwargs["params"]["cursor"] == "next+value"
  assert loader.session.get.call_args_list[0].args[0] == "https://example.test/wiki/rest/api/search"


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 403, 410, 502])
async def test_failed_page_read_is_not_an_empty_success(status: int) -> None:
  loader = make_loader()
  loader.session = MagicMock()
  loader.session.get.return_value = response({}, status)
  fetched, failure = await loader.fetch_page_content("123")
  assert fetched is None and failure is not None
  assert str(status) in failure[1]


@pytest.mark.asyncio
async def test_missing_body_is_a_fetch_failure() -> None:
  loader = make_loader()
  loader.session = MagicMock()
  loader.session.get.return_value = response({"results": [{"content": page("123", None)}]})
  fetched, failure = await loader.fetch_page_content("123")
  assert fetched is None and "storage body" in failure[1]


@pytest.mark.asyncio
async def test_repeated_cursor_is_recorded_as_partial_failure() -> None:
  loader = make_loader()
  loader.session = MagicMock()
  loader.session.get.side_effect = [
    response({"results": [{"content": page("123")}], "_links": {"next": "/search?cursor=next"}}),
    response({"results": [{"content": page("456")}], "_links": {"next": "/search?cursor=next"}}),
  ]
  pages, failures = await loader.load_pages("EXAMPLE")
  assert len(pages) == 2 and len(failures) == 1
  assert "repeated a cursor" in failures[0][1]


@pytest.mark.asyncio
async def test_child_enumeration_preserves_direct_parent_scope_and_cap() -> None:
  loader = make_loader()
  loader.session = MagicMock()
  loader.session.get.return_value = response({"results": [{"content": page("456")}, {"content": page("789")}]})
  ids, failures, truncated = await loader.fetch_child_pages("123", max_results=1)
  assert ids == ["456"] and failures == [] and truncated is True
  assert "parent=123" in loader.session.get.call_args.kwargs["params"]["cql"]


def test_table_columns_links_and_external_status_provenance_survive_chunking() -> None:
  loader = make_loader()
  rows = "".join(f"<tr><td>Item {index}</td><td>Complete</td><td>Open</td></tr>" for index in range(400))
  html = '<table><tr><th>Item</th><th>Manual</th><th>Workflow</th></tr>' + rows + '</table>'
  html += '<a href="https://example.test/task/1">Task</a><ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">EXAMPLE-1</ac:parameter></ac:structured-macro>'
  text = loader.extract_text_from_html(html)
  assert "Manual: Complete | Workflow: Open" in text
  assert "Task (https://example.test/task/1)" in text
  assert "EXAMPLE-1" in text and "live issue status was not fetched" in text
  chunks = loader.text_splitter.split_text(text)
  assert len(chunks) > 1 and all(len(chunk) <= 1000 for chunk in chunks)
  assert all(f"Item {index}" in "\n".join(chunks) for index in range(400))
