"""Focused tests for the non-persisting Confluence ingestion preview."""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

os.environ.setdefault("CONFLUENCE_URL", "https://example.test/wiki")
os.environ.setdefault("CONFLUENCE_USERNAME", "test-user@example.com")
os.environ.setdefault("CONFLUENCE_TOKEN", "test-token")

# The executable module supports direct script startup and therefore imports
# its sibling as `loader`. Alias the package import for unit-test collection.
from ingestors.confluence import loader as loader_module  # noqa: E402

sys.modules.setdefault("loader", loader_module)

import ingestors.confluence.ingestor as ingestor_module  # noqa: E402
from common.models.server import ConfluenceIngestRequest  # noqa: E402
from common.job_manager import JobStatus  # noqa: E402
from common.models.rag import DataSourceInfo  # noqa: E402


@pytest.mark.asyncio
async def test_preview_page_uses_bounded_selection_without_ingesting(
  monkeypatch: pytest.MonkeyPatch,
) -> None:
  loader = MagicMock()
  loader.__aenter__ = AsyncMock(return_value=loader)
  loader.__aexit__ = AsyncMock(return_value=None)
  loader.load_pages = AsyncMock(
    return_value=(
      [
        {
          "id": "123",
          "title": "Example root",
          "_links": {"webui": "/spaces/EXAMPLE/pages/123"},
        }
      ],
      [("456", "Child page could not be loaded")],
    )
  )
  loader.last_load_truncated = True
  loader_factory = MagicMock(return_value=loader)
  monkeypatch.setattr(ingestor_module, "ConfluenceLoader", loader_factory)

  rag_client = MagicMock()
  rag_client.ingestor_id = "confluence:example"
  rag_client.ingest_documents = AsyncMock()
  request = ConfluenceIngestRequest(
    url="https://example.test/wiki/spaces/EXAMPLE/pages/123/Root",
    get_child_pages=True,
    reload_interval=86400,
  )

  result = await ingestor_module.preview_page_ingestion(rag_client, request)

  loader.load_pages.assert_awaited_once_with(
    "EXAMPLE",
    [{"page_id": "123", "get_child_pages": True}],
    max_pages=ingestor_module.PREVIEW_MAX_ITEMS + 1,
  )
  assert result["truncated"] is True
  assert result["items"] == [
    {
      "id": "123",
      "title": "Example root",
      "url": "https://example.test/wiki/spaces/EXAMPLE/pages/123",
    }
  ]
  assert result["warnings"] == ["Child page could not be loaded"]
  rag_client.ingest_documents.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(("status", "failed", "truncated", "expected"), [
  (JobStatus.COMPLETED, 0, False, True),
  (JobStatus.COMPLETED, 0, True, False),
  (JobStatus.COMPLETED, 1, False, False),
  (JobStatus.COMPLETED_WITH_ERRORS, 1, False, False),
  (JobStatus.FAILED, 1, False, False),
  (JobStatus.TERMINATED, 0, False, False),
  (JobStatus.IN_PROGRESS, 0, False, False),
])
async def test_freshness_requires_full_success(status: JobStatus, failed: int, truncated: bool, expected: bool) -> None:
  datasource = DataSourceInfo(datasource_id="source-example", ingestor_id="confluence:example", source_type="confluence", last_updated=123)
  job_manager = MagicMock()
  job_manager.get_job = AsyncMock(return_value=MagicMock(status=status, failed_counter=failed))
  client = MagicMock()
  client.upsert_datasource = AsyncMock()
  result = await ingestor_module.advance_datasource_freshness(client, job_manager, datasource, "job-example", truncated)
  assert result is expected
  if expected:
    assert datasource.last_updated > 123
    client.upsert_datasource.assert_awaited_once()
  else:
    assert datasource.last_updated == 123
    client.upsert_datasource.assert_not_awaited()


def test_new_datasource_does_not_claim_a_successful_fetch() -> None:
  datasource = ingestor_module._create_datasource_info("source-example", "confluence:example", "EXAMPLE", "Example source")
  assert datasource.last_updated is None


@pytest.mark.asyncio
@pytest.mark.parametrize("entrypoint", ["direct", "reload", "auto"])
@pytest.mark.parametrize("partial", [False, True])
async def test_ingestion_entrypoints_preserve_freshness_on_partial_fetch(
  monkeypatch: pytest.MonkeyPatch, entrypoint: str, partial: bool,
) -> None:
  datasource_id = ingestor_module.generate_datasource_id(ingestor_module.CONFLUENCE_URL, "EXAMPLE", "123" if entrypoint == "direct" else None)
  datasource = DataSourceInfo(
    datasource_id=datasource_id, ingestor_id="confluence:example", source_type="confluence",
    last_updated=123, metadata={"space_key": "EXAMPLE", "page_configs": [{"page_id": "123"}]},
  )
  job = MagicMock(status=JobStatus.IN_PROGRESS, failed_counter=0, datasource_id=datasource_id)
  jm = MagicMock()
  jm.get_job = AsyncMock(return_value=job)
  jm.upsert_job = AsyncMock()
  jm.increment_failure = AsyncMock()
  client = MagicMock(ingestor_id="confluence:example")
  client.list_datasources = AsyncMock(return_value=[datasource])
  client.create_job = AsyncMock(return_value={"job_id": "job-example"})
  client.upsert_datasource = AsyncMock()
  loader = MagicMock(last_load_truncated=False)
  loader.__aenter__ = AsyncMock(return_value=loader)
  loader.__aexit__ = AsyncMock(return_value=None)
  loader.load_pages = AsyncMock(return_value=([{ "id": "123" }], [("456", "Page denied")] if partial else []))

  async def ingest(*args, **kwargs):
    job.status = JobStatus.COMPLETED_WITH_ERRORS if partial else JobStatus.COMPLETED
    job.failed_counter = 1 if partial else 0

  loader.ingest_pages = AsyncMock(side_effect=ingest)
  monkeypatch.setattr(ingestor_module, "ConfluenceLoader", lambda **kwargs: loader)
  monkeypatch.setattr(ingestor_module, "JobManager", lambda *args: jm)
  monkeypatch.setattr(ingestor_module, "CONFLUENCE_SPACES", '{"EXAMPLE":[{"page_id":"123"}]}')
  monkeypatch.setattr(ingestor_module, "reload_persisted_datasources", AsyncMock())
  if entrypoint == "direct":
    await ingestor_module.process_page_ingestion(client, jm, ConfluenceIngestRequest(url="https://example.test/wiki/spaces/EXAMPLE/pages/123", reload_interval=86400), "job-example")
  elif entrypoint == "reload":
    await ingestor_module.reload_datasource(client, jm, datasource, "job-example")
  else:
    await ingestor_module.periodic_reload(client)
  loader.ingest_pages.assert_awaited_once()
  if partial:
    assert datasource.last_updated == 123
    client.upsert_datasource.assert_not_awaited()
    jm.increment_failure.assert_awaited_once()
  else:
    assert datasource.last_updated > 123
    client.upsert_datasource.assert_awaited_once()
