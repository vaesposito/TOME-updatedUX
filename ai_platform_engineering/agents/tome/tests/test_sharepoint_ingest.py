"""Opt-in document ingestion never broadens source credentials or live state."""

from pathlib import Path
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from tome_agent.agent import ingestor, synthesize
from tome_agent.agent.sharepoint_documents import (
    PreparedDocument,
    SharePointPreparationError,
)
from tome_agent.orchestrator.contract import (
    ExperimentRunContext,
    IngestRequest,
    ProjectSnapshot,
    RepoSnapshot,
)


def request(**overrides):
    values = {
        "run_id": uuid4(),
        "report_id": uuid4(),
        "is_greenfield": True,
        "snapshot": ProjectSnapshot(project_id="project-1", name="Example"),
        "connector_data": {
            "sharepoint": {"documents": [{"drive_id": "drive-1", "item_id": "item-1"}]}
        },
    }
    return IngestRequest(**{**values, **overrides})


@pytest.mark.parametrize(
    "selection",
    [
        {"documents": [{"drive_id": "../other", "item_id": "item-1"}]},
        {
            "documents": [
                {
                    "drive_id": "drive-1",
                    "item_id": "item-1",
                    "url": "https://example.com/private",
                }
            ]
        },
        {"documents": [{"drive_id": "drive-1", "item_id": "item-1"}] * 11},
        None,
    ],
)
def test_request_rejects_invalid_document_scope(selection) -> None:
    with pytest.raises(ValidationError):
        request(connector_data={"sharepoint": selection})


def test_frozen_experiment_rejects_live_documents() -> None:
    experiment = ExperimentRunContext(
        experiment_id="experiment-1",
        artifact_id="artifact-1",
        evidence_bundle_id="bundle-1",
        blind_label="primary",
        model="example-model",
        seed=1,
    )
    with pytest.raises(ValidationError, match="Frozen experiments"):
        request(experiment=experiment)


def mocks(monkeypatch, tmp_path):
    monkeypatch.setenv("TTT_PROJECT_ROOT", str(tmp_path))
    monkeypatch.setattr(ingestor.http_client, "fetch_page_templates", lambda: None)
    monkeypatch.setattr(ingestor.http_client, "fetch_model_config", lambda *args: None)
    monkeypatch.setattr(ingestor.http_client, "fetch_all_pages_sync", lambda *args: {})
    monkeypatch.setattr(
        ingestor, "resolve_connector_extras", AsyncMock(return_value={})
    )
    monkeypatch.setattr(ingestor, "write_verbatim_pages", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        ingestor.report_schema, "reconcile_template_bindings", lambda *args: {}
    )
    monkeypatch.setattr(ingestor, "build_agent_options", lambda **kwargs: kwargs)
    calls = []

    async def consume(prompt, options, log_buf, **kwargs):
        calls.append({"prompt": prompt, "options": options, **kwargs})
        if False:
            yield None

    monkeypatch.setattr(ingestor, "consume_agent_query", consume)
    return calls


def prepared(tmp_path: Path) -> PreparedDocument:
    return PreparedDocument(
        tmp_path / ".source-cache/project-1/version-1",
        {
            "drive_id": "drive-1",
            "item_id": "item-1",
            "version": "v1",
            "name": "Example.pptx",
            "web_url": "https://example.sharepoint.com/example.pptx",
        },
        {
            "page_count": 2,
            "slides_with_notes": 1,
            "batches": [{"path": "pages-0001-0002.pdf", "source_slides": [1, 2]}],
            "warnings": [],
        },
    )


@pytest.mark.asyncio
async def test_document_only_run_uses_one_restricted_pass(
    monkeypatch, tmp_path
) -> None:
    calls = mocks(monkeypatch, tmp_path)
    document = prepared(tmp_path)
    prepare = AsyncMock(return_value=document)
    monkeypatch.setattr(
        ingestor.SharePointPreparer,
        "from_env",
        lambda *_: type("Preparer", (), {"prepare": prepare})(),
    )
    body = request()
    events = [
        event
        async for event in ingestor.stream_ingest(
            run_id=body.run_id,
            report_id=body.report_id,
            snapshot=body.snapshot,
            connector_data=body.connector_data,
            seed="Explain the architecture.",
            is_greenfield=True,
        )
    ]
    assert len(calls) == 1
    options = calls[0]["options"]
    assert options["restrict_untrusted_evidence"] is True
    assert options["max_buffer_size"] == 64 * 1_048_576
    assert options["extra_read_dirs"] == [document.directory]
    assert options["snapshot"].repos == []
    assert options["snapshot"].child_projects == []
    assert calls[0]["redact_sensitive_content"] is True
    assert events
    assert "Explain the architecture." in calls[0]["prompt"]
    assert "pages-0001-0002.pdf" in options["system_prompt"]


@pytest.mark.parametrize("project_type", ["area", "bhag"])
@pytest.mark.asyncio
async def test_synthesis_prepares_documents_and_keeps_child_wikis_out_of_document_pass(monkeypatch, tmp_path, project_type) -> None:
    calls = mocks(monkeypatch, tmp_path)
    document = prepared(tmp_path)
    monkeypatch.setattr(ingestor.SharePointPreparer, "from_env", lambda *_: type("Preparer", (), {"prepare": AsyncMock(return_value=document)})())
    monkeypatch.setattr(synthesize, "build_agent_options", lambda **kwargs: kwargs)
    monkeypatch.setattr(synthesize, "resolve_connector_extras", AsyncMock(return_value={}))

    async def consume(prompt, options, log_buf, **kwargs):
        calls.append({"prompt": prompt, "options": options, **kwargs})
        if False:
            yield None

    monkeypatch.setattr(synthesize, "consume_agent_query", consume)
    snapshot = ProjectSnapshot(project_id="project-1", name="Example", project_type=project_type,
        child_projects=[{"project_id": "child-1", "name": "Example child", "slug": "example-child"}])
    body = request(snapshot=snapshot)
    events = [event async for event in synthesize.stream_synthesis(run_id=body.run_id, report_id=body.report_id,
        snapshot=snapshot, connector_data=body.connector_data, seed=None, is_greenfield=True)]
    assert len(calls) == 2
    assert calls[0]["options"]["restrict_untrusted_evidence"] is True
    assert calls[0]["options"]["snapshot"].child_projects == []
    assert calls[0]["options"]["extra_read_dirs"] == [document.directory]
    assert calls[1]["options"]["extra_read_dirs"] == [tmp_path / "child-1"]
    assert not any(event.type == "error" for event in events)


@pytest.mark.asyncio
async def test_synthesis_does_not_write_if_document_preparation_fails(monkeypatch, tmp_path) -> None:
    calls = mocks(monkeypatch, tmp_path)
    monkeypatch.setattr(ingestor.SharePointPreparer, "from_env", lambda *_: type("Preparer", (), {
        "prepare": AsyncMock(side_effect=SharePointPreparationError("No access"))})())
    body = request(snapshot=ProjectSnapshot(project_id="project-1", name="Example", project_type="area"))
    events = [event async for event in synthesize.stream_synthesis(run_id=body.run_id, report_id=body.report_id,
        snapshot=body.snapshot, connector_data=body.connector_data, seed=None, is_greenfield=True)]
    assert any(event.type == "error" for event in events)
    assert calls == []


@pytest.mark.asyncio
async def test_document_failure_never_starts_model_or_writes_pages(
    monkeypatch, tmp_path
) -> None:
    calls = mocks(monkeypatch, tmp_path)
    prepare = AsyncMock(side_effect=SharePointPreparationError("Conversion failed."))
    monkeypatch.setattr(
        ingestor.SharePointPreparer,
        "from_env",
        lambda *_: type("Preparer", (), {"prepare": prepare})(),
    )
    body = request()
    events = [
        event
        async for event in ingestor.stream_ingest(
            run_id=body.run_id,
            report_id=body.report_id,
            snapshot=body.snapshot,
            connector_data=body.connector_data,
            seed=None,
            is_greenfield=True,
        )
    ]
    assert not calls
    assert events[-1].type == "error"
    ingestor.write_verbatim_pages.assert_not_awaited()


@pytest.mark.asyncio
async def test_mixed_sources_are_not_exposed_to_document_pass(
    monkeypatch, tmp_path
) -> None:
    calls = mocks(monkeypatch, tmp_path)
    document = prepared(tmp_path)
    prepare = AsyncMock(return_value=document)
    monkeypatch.setattr(
        ingestor.SharePointPreparer,
        "from_env",
        lambda *_: type("Preparer", (), {"prepare": prepare})(),
    )
    snapshot = ProjectSnapshot(
        project_id="project-1",
        name="Example",
        repos=[
            RepoSnapshot(
                slug="example/primary", url="https://github.com/example/primary"
            )
        ],
    )
    body = request(snapshot=snapshot)
    _ = [
        event
        async for event in ingestor.stream_ingest(
            run_id=body.run_id,
            report_id=body.report_id,
            snapshot=body.snapshot,
            connector_data=body.connector_data,
            seed=None,
            is_greenfield=True,
        )
    ]
    assert len(calls) == 2
    assert calls[0]["options"]["snapshot"].repos
    assert calls[1]["options"]["snapshot"].repos == []
    assert calls[1]["options"]["restrict_untrusted_evidence"] is True


@pytest.mark.asyncio
async def test_existing_ingestion_does_not_implicitly_download_documents(
    monkeypatch, tmp_path
) -> None:
    calls = mocks(monkeypatch, tmp_path)
    prepare = AsyncMock()
    monkeypatch.setattr(ingestor.SharePointPreparer, "from_env", prepare)
    body = request(connector_data={})
    _ = [
        event
        async for event in ingestor.stream_ingest(
            run_id=body.run_id,
            report_id=body.report_id,
            snapshot=body.snapshot,
            connector_data={},
            seed=None,
            is_greenfield=True,
        )
    ]
    prepare.assert_not_called()
    assert len(calls) == 1
    assert "restrict_untrusted_evidence" not in calls[0]["options"]
    assert "max_buffer_size" not in calls[0]["options"]


@pytest.mark.asyncio
async def test_document_pass_applies_configured_buffer(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("TOME_DOCUMENT_SDK_MAX_BUFFER_MIB", "48")
    calls = mocks(monkeypatch, tmp_path)
    document = prepared(tmp_path)
    monkeypatch.setattr(
        ingestor.SharePointPreparer,
        "from_env",
        lambda *_: type("Preparer", (), {"prepare": AsyncMock(return_value=document)})(),
    )
    body = request()
    events = [
        event async for event in ingestor.stream_ingest(
            run_id=body.run_id, report_id=body.report_id, snapshot=body.snapshot,
            connector_data=body.connector_data, seed=None, is_greenfield=True,
        )
    ]
    assert calls[0]["options"]["max_buffer_size"] == 48 * 1_048_576
    assert not any(event.type == "error" for event in events)
