"""PPTX/PDF preparation and authenticated, version-consistent staging."""

from __future__ import annotations

import asyncio
import json
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest
from pypdf import PdfWriter

from tome_agent.agent import document_renderer as renderer
from tome_agent.agent import document_worker as worker
from tome_agent.agent.loop import make_constrain_reads_hook, make_constrain_writes_hook
from tome_agent.agent.sharepoint_documents import (
    SharePointDocumentRef,
    SharePointPreparationError,
    SharePointPreparer,
)


def make_pdf(path: Path, pages: int = 2, *, encrypted: bool = False) -> None:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=400, height=300)
    if encrypted:
        writer.encrypt("example-password")
    writer.write(path)
    writer.close()


def make_pptx(
    path: Path,
    *,
    hidden: bool = False,
    target: str = "slides/slide7.xml",
    note: str = "A speaker note",
    extension_ids: bool = False,
) -> None:
    namespace = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        extension = (
            '<p:extLst><p:ext><x:sldIdLst xmlns:x="http://schemas.microsoft.com/office/powerpoint/2010/main"><x:sldId id="1"/></x:sldIdLst></p:ext></p:extLst>'
            if extension_ids
            else ""
        )
        archive.writestr(
            "ppt/presentation.xml",
            f'<p:presentation {namespace}><p:sldIdLst><p:sldId id="1" r:id="first"/><p:sldId id="2" r:id="second"/></p:sldIdLst>{extension}</p:presentation>',
        )
        archive.writestr(
            "ppt/_rels/presentation.xml.rels",
            f'<Relationships><Relationship Id="first" Type="/slide" Target="{target}"/><Relationship Id="second" Type="/slide" Target="slides/slide2.xml"/></Relationships>',
        )
        archive.writestr(
            "ppt/slides/slide7.xml",
            f"<p:sld {namespace}><p:sp><a:p><a:r><a:t>First slide</a:t></a:r></a:p><a:p><a:r><a:t>Important text</a:t></a:r></a:p></p:sp></p:sld>",
        )
        show = 'show="0"' if hidden else ""
        archive.writestr(
            "ppt/slides/slide2.xml",
            f"<p:sld {namespace} {show}><p:sp><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sp></p:sld>",
        )
        archive.writestr(
            "ppt/slides/_rels/slide7.xml.rels",
            '<Relationships><Relationship Id="note" Type="/notesSlide" Target="../notesSlides/notesSlide1.xml"/><Relationship Id="link" Type="/hyperlink" TargetMode="External" Target="https://example.com/private"/></Relationships>',
        )
        archive.writestr(
            "ppt/notesSlides/notesSlide1.xml",
            f'<p:notes {namespace}><p:sp><a:p><a:r><a:t>{note}</a:t></a:r></a:p></p:sp><p:sp><p:ph type="sldNum"/><a:p><a:r><a:t>99</a:t></a:r></a:p></p:sp></p:notes>',
        )
        archive.writestr("ppt/media/media1.mp4", b"placeholder-media")


def test_presentation_preserves_slide_order_text_notes_and_skips_media(
    tmp_path: Path,
) -> None:
    path = tmp_path / "source.pptx"
    make_pptx(path)
    result = worker.PresentationReader(path).read(10)
    assert result["slides"][0]["title"] == "First slide"
    assert result["slides"][1]["title"] == "Second slide"
    assert result["slides"][0]["notes"] == "A speaker note"
    assert "99" not in result["slides"][0]["notes"]
    assert result["embedded_av_files"] == 1


def test_visual_batches_and_notes_are_readable_sdk_inputs(tmp_path: Path) -> None:
    source, pdf, output = (
        tmp_path / "source.pptx",
        tmp_path / "rendered.pdf",
        tmp_path / "prepared",
    )
    make_pptx(source)
    make_pdf(pdf)
    manifest = worker.prepare_document(source, pdf, output, batch_pages=1)
    assert len(manifest["batches"]) == 2
    assert manifest["batches"][0]["source_slides"] == [1]
    assert manifest["slides_with_notes"] == 1
    assert "A speaker note" in (output / "slide-0001.md").read_text()
    assert (output / manifest["batches"][0]["path"]).read_bytes().startswith(b"%PDF-")
    assert manifest["warnings"]


def test_hidden_slide_text_is_preserved_when_pdf_omits_it(tmp_path: Path) -> None:
    source, pdf, output = (
        tmp_path / "source.pptx",
        tmp_path / "rendered.pdf",
        tmp_path / "prepared",
    )
    make_pptx(source, hidden=True)
    make_pdf(pdf, 1)
    manifest = worker.prepare_document(source, pdf, output)
    assert manifest["batches"][0]["source_slides"] == [1]
    assert (output / "slide-0002.md").is_file()
    assert any("hidden" in message for message in manifest["warnings"])


def test_mismatched_rendered_slide_count_fails_instead_of_misattribution(
    tmp_path: Path,
) -> None:
    source, pdf = tmp_path / "source.pptx", tmp_path / "rendered.pdf"
    make_pptx(source)
    make_pdf(pdf, 1)
    with pytest.raises(worker.DocumentPreparationError, match="does not match"):
        worker.prepare_document(source, pdf, tmp_path / "prepared")


def test_scanned_pdf_keeps_visual_pages_and_reports_missing_text(
    tmp_path: Path,
) -> None:
    pdf = tmp_path / "scan.pdf"
    make_pdf(pdf)
    manifest = worker.prepare_document(pdf, pdf, tmp_path / "prepared")
    assert manifest["textless_pages"] == 2
    assert manifest["batches"]
    assert any("visual" in message for message in manifest["warnings"])


def test_encrypted_pdf_is_rejected(tmp_path: Path) -> None:
    pdf = tmp_path / "encrypted.pdf"
    make_pdf(pdf, encrypted=True)
    with pytest.raises(worker.DocumentPreparationError, match="Password"):
        worker.prepare_document(pdf, pdf, tmp_path / "prepared")


def test_slide_relationship_cannot_escape_package(tmp_path: Path) -> None:
    source = tmp_path / "source.pptx"
    make_pptx(source, target="../../outside.xml")
    with pytest.raises(worker.DocumentPreparationError, match="escaped"):
        worker.PresentationReader(source).read(10)


def test_package_absolute_slide_relationship_is_supported(tmp_path: Path) -> None:
    source = tmp_path / "source.pptx"
    make_pptx(source, target="/ppt/slides/slide7.xml")
    assert (
        worker.PresentationReader(source).read(10)["slides"][0]["title"]
        == "First slide"
    )


def test_unrelated_relationships_are_not_dereferenced(tmp_path: Path) -> None:
    source = tmp_path / "source.pptx"
    make_pptx(source)
    with zipfile.ZipFile(source, "a") as archive:
        archive.writestr(
            "ppt/slides/_rels/slide2.xml.rels",
            '<Relationships><Relationship Id="custom" Type="/customXml" Target="../../customXml/item1.xml"/></Relationships>',
        )
    assert len(worker.PresentationReader(source).read(10)["slides"]) == 2


def test_extension_persistent_slide_ids_are_not_slide_relationships(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source.pptx"
    make_pptx(source, extension_ids=True)
    assert len(worker.PresentationReader(source).read(10)["slides"]) == 2


def test_rendering_copy_removes_av_and_external_relationships(tmp_path: Path) -> None:
    source, target = tmp_path / "source.pptx", tmp_path / "visual.pptx"
    make_pptx(source)
    renderer.visual_copy(source, target)
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(target) as visual:
        assert "ppt/media/media1.mp4" in original.namelist()
        assert "ppt/media/media1.mp4" not in visual.namelist()
        assert b"example.com/private" not in visual.read(
            "ppt/slides/_rels/slide7.xml.rels"
        )
        assert visual.read("ppt/slides/slide7.xml") == original.read(
            "ppt/slides/slide7.xml"
        )


def test_rendering_copy_retains_the_relationship_default_namespace(
    tmp_path: Path,
) -> None:
    source, target = tmp_path / "source.pptx", tmp_path / "visual.pptx"
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr(
            "_rels/.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
        )
    renderer.visual_copy(source, target)
    with zipfile.ZipFile(target) as archive:
        assert b"<Relationships xmlns=" in archive.read("_rels/.rels")
        assert b"ns0:" not in archive.read("_rels/.rels")


def test_rendering_copy_rejects_oversized_relationship_xml_before_read(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source.pptx"
    with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("_rels/.rels", b"x" * 2_097_153)
    with pytest.raises(ValueError, match="XML limit"):
        renderer.visual_copy(source, tmp_path / "visual.pptx")


@pytest.mark.parametrize("timeout", [0, -1, float("nan"), float("inf"), 1801])
def test_invalid_timeouts_are_rejected(tmp_path: Path, timeout: float) -> None:
    with pytest.raises(SharePointPreparationError, match="timeouts"):
        SharePointPreparer(
            "http://sharepoint.example.test",
            "test-token",
            tmp_path,
            timeout_seconds=timeout,
        )


def test_xml_limit_and_slide_limit_are_enforced(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "source.pptx"
    make_pptx(source)
    with pytest.raises(worker.DocumentPreparationError, match="slides"):
        worker.PresentationReader(source).read(1)
    monkeypatch.setattr(worker, "MAX_XML_PART_BYTES", 20)
    with pytest.raises(worker.DocumentPreparationError, match="XML"):
        worker.PresentationReader(source).read(10)


@pytest.mark.parametrize("encoding", ["utf-8", "utf-16"])
def test_xml_entities_are_rejected(tmp_path: Path, encoding: str) -> None:
    source = tmp_path / "source.pptx"
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr(
            "ppt/presentation.xml",
            '<!DOCTYPE test [<!ENTITY a "example">]><test>&a;</test>'.encode(encoding),
        )
    with pytest.raises(worker.DocumentPreparationError, match="entity"):
        worker.PresentationReader(source).read(10)


def test_pdf_batches_split_again_when_byte_limit_is_exceeded(
    tmp_path: Path, monkeypatch
) -> None:
    pdf = tmp_path / "source.pdf"
    make_pdf(pdf, 8)
    monkeypatch.setattr(worker, "MAX_PDF_BATCH_BYTES", 900)
    manifest = worker.prepare_document(pdf, pdf, tmp_path / "prepared", batch_pages=8)
    assert len(manifest["batches"]) > 1
    assert all(batch["bytes"] <= 900 for batch in manifest["batches"])
    assert [n for batch in manifest["batches"] for n in batch["source_slides"]] == list(
        range(1, 9)
    )


def test_document_roots_are_read_only_and_do_not_grant_other_project_access(
    tmp_path: Path,
) -> None:
    project = tmp_path / "project-1"
    prepared = tmp_path / ".source-cache" / "project-1" / "version-1"
    read = make_constrain_reads_hook(project, [prepared], allow_override=False)
    assert (
        asyncio.run(
            read(
                {
                    "tool_name": "Read",
                    "tool_input": {"file_path": str(prepared / "pages.pdf")},
                },
                "id",
                {},
            )
        )
        == {}
    )
    denied = asyncio.run(
        read(
            {
                "tool_name": "Read",
                "tool_input": {
                    "file_path": str(tmp_path / ".source-cache/project-2/pages.pdf")
                },
            },
            "id",
            {},
        )
    )
    assert denied["hookSpecificOutput"]["permissionDecision"] == "deny"
    write = make_constrain_writes_hook(project)
    denied_write = asyncio.run(
        write(
            {
                "tool_name": "Write",
                "tool_input": {"file_path": str(prepared / "slide.md")},
            },
            "id",
            {},
        )
    )
    assert denied_write["hookSpecificOutput"]["permissionDecision"] == "deny"


def run_prepare(
    tmp_path: Path, *, changed_version: bool = False, oversized: bool = False
):
    pdf = tmp_path / "input.pdf"
    make_pdf(pdf)
    content = pdf.read_bytes()
    requests: list[str] = []
    metadata_count = 0

    def serve(request: httpx.Request) -> httpx.Response:
        nonlocal metadata_count
        assert request.headers["authorization"] == "Bearer test-token"
        requests.append(request.url.path)
        if request.url.path.endswith("/metadata"):
            metadata_count += 1
            return httpx.Response(
                200,
                json={
                    "drive_id": "drive-1",
                    "item_id": "item-1",
                    "format": "pdf",
                    "version": "v2" if changed_version and metadata_count > 1 else "v1",
                    "name": "Example.pdf",
                    "size": len(content),
                    "web_url": "https://example.sharepoint.com/source.pdf",
                    "original_path": "https://evil.example/private",
                },
            )
        return httpx.Response(
            200, content=content + (b"extra" * 1000 if oversized else b"")
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(serve)) as http:
            preparer = SharePointPreparer(
                "http://sharepoint.example.test:8000",
                "test-token",
                tmp_path / "workspace",
                http_client=http,
                max_document_bytes=1024 if oversized else 2_147_483_648,
            )
            ref = SharePointDocumentRef(drive_id="drive-1", item_id="item-1")
            first = await preparer.prepare("project-1", ref)
            second = await preparer.prepare("project-1", ref)
            return first, second

    return asyncio.run(run()), requests


def test_real_worker_stages_and_reuses_unchanged_version(tmp_path: Path) -> None:
    (first, second), requests = run_prepare(tmp_path)
    assert first.directory == second.directory
    assert not first.cache_hit and second.cache_hit
    assert ".source-cache/project-1" in str(first.directory)
    assert sum(path.endswith("/content") for path in requests) == 1
    assert not list(first.directory.parent.glob(".prepare-*"))
    assert not list(first.directory.parent.glob("**/source.pdf"))
    assert "test-token" not in (first.directory / "source.json").read_text()
    assert "pages-" in first.prompt_block()


def test_version_change_rejects_partial_cache_without_touching_existing_versions(
    tmp_path: Path,
) -> None:
    existing = tmp_path / "workspace/.source-cache/project-1/old-version"
    existing.mkdir(parents=True)
    (existing / "keep.txt").write_text("keep")
    with pytest.raises(SharePointPreparationError, match="changed"):
        run_prepare(tmp_path, changed_version=True)
    assert (existing / "keep.txt").read_text() == "keep"
    assert not list(existing.parent.glob(".prepare-*"))


def test_oversized_stream_is_not_published(tmp_path: Path) -> None:
    with pytest.raises(SharePointPreparationError, match="streaming"):
        run_prepare(tmp_path, oversized=True)
    assert not list((tmp_path / "workspace").glob("**/manifest.json"))
    assert not list((tmp_path / "workspace").glob("**/.prepare-*"))


@pytest.mark.parametrize(
    "project_id", ["../project-2", "..", "a/b", "a\\b", ".source-cache"]
)
def test_project_identifier_cannot_escape_cache(
    tmp_path: Path, project_id: str
) -> None:
    preparer = SharePointPreparer(
        "http://sharepoint.example.test", "test-token", tmp_path
    )
    with pytest.raises(SharePointPreparationError, match="project identifier"):
        asyncio.run(
            preparer.prepare(
                project_id, SharePointDocumentRef(drive_id="drive-1", item_id="item-1")
            )
        )


def test_authentication_is_required_and_not_written_to_metadata(tmp_path: Path) -> None:
    with pytest.raises(SharePointPreparationError, match="authentication"):
        SharePointPreparer("http://sharepoint.example.test", "", tmp_path)
    assert json.dumps(
        SharePointDocumentRef(drive_id="drive-1", item_id="item-1").model_dump()
    )


@pytest.mark.parametrize("conversion_status", [403, 404, 500, 502])
@pytest.mark.asyncio
async def test_local_fallback_never_bypasses_provider_access_denial(
    tmp_path: Path, monkeypatch, conversion_status: int
) -> None:
    source = tmp_path / "input.pptx"
    make_pptx(source)
    content = source.read_bytes()

    def serve(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/metadata"):
            return httpx.Response(
                200,
                json={
                    "drive_id": "drive-1",
                    "item_id": "item-1",
                    "format": "pptx",
                    "version": "v1",
                    "name": "Example.pptx",
                    "size": len(content),
                    "web_url": "https://example.sharepoint.com/example.pptx",
                },
            )
        if request.url.query:
            return httpx.Response(
                conversion_status, json={"code": "document_download_failed"}
            )
        return httpx.Response(200, content=content)

    async def render(source: Path, target: Path) -> None:
        make_pdf(target)

    render_mock = AsyncMock(side_effect=render)
    async with httpx.AsyncClient(transport=httpx.MockTransport(serve)) as http:
        preparer = SharePointPreparer(
            "http://sharepoint.example.test",
            "test-token",
            tmp_path / "workspace",
            http_client=http,
        )
        monkeypatch.setattr(preparer, "_render", render_mock)
        ref = SharePointDocumentRef(drive_id="drive-1", item_id="item-1")
        if conversion_status in {403, 404}:
            with pytest.raises(
                SharePointPreparationError, match=f"HTTP {conversion_status}"
            ):
                await preparer.prepare("project-1", ref)
            render_mock.assert_not_called()
            assert not list((tmp_path / "workspace").glob("**/manifest.json"))
        else:
            document = await preparer.prepare("project-1", ref)
            render_mock.assert_awaited_once()
            assert document.manifest["renderer"] == "local"


def test_incomplete_cache_is_not_automatically_repaired(tmp_path: Path) -> None:
    (first, _), _ = run_prepare(tmp_path)
    (first.directory / "page-0001.txt").unlink()
    with pytest.raises(SharePointPreparationError, match="No automatic cache repair"):
        run_prepare(tmp_path)
    assert not (first.directory / "page-0001.txt").exists()
