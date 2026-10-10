"""Trusted document preparation, run in a bounded subprocess, never agent Bash.

PPTX media is not decompressed to extract text/notes. PDF batches retain slide
visuals for SDK Read; videos, animations, and linked content are not executed.
"""

from __future__ import annotations

import argparse
import json
import posixpath
import resource
import sys
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError

MAX_XML_PART_BYTES = 2_097_152
MAX_XML_TOTAL_BYTES = 67_108_864
MAX_ARCHIVE_ENTRIES = 10_000
MAX_TEXT_CHARACTERS = 2_000_000
MAX_PDF_BATCH_BYTES = 20_971_520
MAX_PREPARED_BYTES = 536_870_912


class DocumentPreparationError(ValueError):
    """The source cannot safely be represented as bounded model input."""


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


class PresentationReader:
    def __init__(self, path: Path) -> None:
        self.archive = zipfile.ZipFile(path)
        if len(self.archive.infolist()) > MAX_ARCHIVE_ENTRIES:
            self.archive.close()
            raise DocumentPreparationError(
                "The PowerPoint has too many archive entries."
            )
        self.xml_bytes = 0

    def xml(self, name: str) -> ElementTree.Element:
        info = self.archive.getinfo(name)
        if (
            info.file_size > MAX_XML_PART_BYTES
            or self.xml_bytes + info.file_size > MAX_XML_TOTAL_BYTES
        ):
            raise DocumentPreparationError(
                "The PowerPoint exceeds the XML extraction limit."
            )
        with self.archive.open(name) as stream:
            data = stream.read(MAX_XML_PART_BYTES + 1)
        if len(data) > MAX_XML_PART_BYTES:
            raise DocumentPreparationError("A slide exceeds the XML extraction limit.")
        self.xml_bytes += len(data)
        # Block DTD/entity declarations, including UTF-16 encodings.
        declarations = data.replace(b"\x00", b"").upper()
        if b"<!DOCTYPE" in declarations or b"<!ENTITY" in declarations:
            raise DocumentPreparationError("XML entity declarations are not permitted.")
        return ElementTree.fromstring(data)

    def relationships(self, part: str) -> dict[str, tuple[str, str]]:
        folder, name = posixpath.split(part)
        rels_path = f"{folder}/_rels/{name}.rels"
        if rels_path not in self.archive.namelist():
            return {}
        result: dict[str, tuple[str, str]] = {}
        for rel in self.xml(rels_path):
            if rel.get("TargetMode") == "External":
                continue
            rel_type = rel.get("Type", "").rsplit("/", 1)[-1]
            # Only these parts are read. Custom XML, thumbnails, and metadata
            # may legitimately live outside ppt/ and must not be dereferenced.
            if rel_type not in {"slide", "notesSlide"}:
                continue
            raw_target = rel.get("Target", "")
            # Open XML permits package-absolute and part-relative targets.
            target = posixpath.normpath(
                raw_target.lstrip("/")
                if raw_target.startswith("/")
                else posixpath.join(folder, raw_target)
            )
            if not target.startswith("ppt/") or "\\" in target:
                raise DocumentPreparationError(
                    "A PowerPoint relationship escaped the presentation package."
                )
            result[rel.get("Id", "")] = (target, rel_type)
        return result

    @staticmethod
    def paragraphs(root: ElementTree.Element, *, notes: bool = False) -> list[str]:
        result: list[str] = []
        containers = [
            node for node in root.iter() if _local(node.tag) in {"sp", "graphicFrame"}
        ]
        for container in containers:
            if notes and any(
                _local(node.tag) == "ph"
                and node.get("type") in {"hdr", "ftr", "dt", "sldNum"}
                for node in container.iter()
            ):
                continue
            for paragraph in container.iter():
                if _local(paragraph.tag) != "p":
                    continue
                text = "".join(
                    node.text or ""
                    for node in paragraph.iter()
                    if _local(node.tag) == "t"
                ).strip()
                if text:
                    result.append(text)
        return result

    def read(self, max_slides: int) -> dict[str, Any]:
        try:
            presentation = self.xml("ppt/presentation.xml")
            rels = self.relationships("ppt/presentation.xml")
            # PowerPoint extension metadata also contains sldId nodes, but
            # those are persistent numeric IDs, not ordered slide references.
            namespace = presentation.tag.rsplit("}", 1)[0] + "}"
            slide_ids = [
                node
                for child in presentation
                if child.tag == namespace + "sldIdLst"
                for node in child
                if node.tag == namespace + "sldId"
            ]
            if not slide_ids or len(slide_ids) > max_slides:
                raise DocumentPreparationError(
                    f"Choose a presentation with 1–{max_slides} slides."
                )
            slides: list[dict[str, Any]] = []
            characters = 0
            for number, identifier in enumerate(slide_ids, 1):
                rid = next(
                    (
                        value
                        for key, value in identifier.attrib.items()
                        if _local(key) == "id" and key.startswith("{")
                    ),
                    "",
                )
                path, kind = rels[rid]
                if kind != "slide":
                    raise DocumentPreparationError(
                        "The presentation has an invalid slide relationship."
                    )
                root = self.xml(path)
                paragraphs = self.paragraphs(root)
                notes: list[str] = []
                for target, rel_type in self.relationships(path).values():
                    if rel_type == "notesSlide":
                        notes.extend(self.paragraphs(self.xml(target), notes=True))
                text = "\n".join(paragraphs)
                note_text = "\n".join(notes)
                characters += len(text) + len(note_text)
                if characters > MAX_TEXT_CHARACTERS:
                    raise DocumentPreparationError(
                        "The presentation exceeds the extracted-text limit."
                    )
                slides.append(
                    {
                        "number": number,
                        "title": paragraphs[0] if paragraphs else "",
                        "text": text,
                        "notes": note_text,
                        "hidden": root.get("show") == "0",
                    }
                )
            media = [
                entry
                for entry in self.archive.infolist()
                if entry.filename.startswith("ppt/media/")
            ]
            videos = sum(
                entry.filename.lower().endswith(
                    (".mp4", ".mov", ".avi", ".wmv", ".m4a", ".mp3", ".wav")
                )
                for entry in media
            )
            return {
                "slides": slides,
                "embedded_media_bytes": sum(entry.file_size for entry in media),
                "embedded_av_files": videos,
            }
        finally:
            self.archive.close()


def prepare_document(
    source: Path,
    pdf: Path,
    output: Path,
    *,
    max_pages: int = 1000,
    batch_pages: int = 8,
) -> dict[str, Any]:
    output.mkdir(parents=True, exist_ok=True)
    reader = PdfReader(pdf, strict=False)
    if reader.is_encrypted:
        raise DocumentPreparationError("Password-protected PDFs are not supported.")
    page_count = len(reader.pages)
    if not page_count or page_count > max_pages:
        raise DocumentPreparationError(f"Choose a PDF with 1–{max_pages} pages.")
    pptx = source.suffix.lower() == ".pptx"
    presentation = PresentationReader(source).read(max_pages) if pptx else {}
    slides = presentation.get("slides", [])
    warnings = (
        [
            "Animations, embedded audio/video, and external linked content are not ingested."
        ]
        if pptx
        else []
    )
    if pptx:
        visible = [slide for slide in slides if not slide["hidden"]]
        if page_count == len(slides):
            page_slides = slides
        elif page_count == len(visible):
            page_slides = visible
            warnings.append(
                "The PDF renderer omitted hidden slides; their text/notes are included without visual pages."
            )
        else:
            raise DocumentPreparationError(
                "Rendered PDF page count does not match the slides. Refusing to misattribute slide content."
            )
    else:
        page_slides = [{"number": i + 1} for i in range(page_count)]
    batches: list[dict[str, Any]] = []
    text_characters = 0
    textless_pages = 0
    output_bytes = 0

    def write_batch(first: int, last: int) -> None:
        nonlocal output_bytes
        writer = PdfWriter()
        for index in range(first, last):
            writer.add_page(reader.pages[index])
        filename = f"pages-{first + 1:04d}-{last:04d}.pdf"
        target = output / filename
        with target.open("wb") as handle:
            writer.write(handle)
        writer.close()
        if target.stat().st_size > MAX_PDF_BATCH_BYTES:
            target.unlink()
            if last - first == 1:
                raise DocumentPreparationError(
                    "One rendered page exceeds the 20 MiB model-input limit."
                )
            midpoint = first + (last - first) // 2
            write_batch(first, midpoint)
            write_batch(midpoint, last)
            return
        output_bytes += target.stat().st_size
        if output_bytes > MAX_PREPARED_BYTES:
            raise DocumentPreparationError(
                "The prepared document exceeds the 512 MiB artifact limit."
            )
        batches.append(
            {
                "path": filename,
                "first_page": first + 1,
                "last_page": last,
                "source_slides": [page_slides[i]["number"] for i in range(first, last)],
                "bytes": target.stat().st_size,
            }
        )

    # Extract per-page PDF text to help the agent search; visuals remain present
    # even for scanned PDFs with no machine-readable text.
    for first in range(0, page_count, batch_pages):
        last = min(first + batch_pages, page_count)
        for index in range(first, last):
            page_text = reader.pages[index].extract_text() or ""
            text_characters += len(page_text)
            if text_characters > MAX_TEXT_CHARACTERS:
                raise DocumentPreparationError(
                    "The PDF exceeds the extracted-text limit."
                )
            if not page_text.strip():
                textless_pages += 1
            (output / f"page-{index + 1:04d}.txt").write_text(
                page_text, encoding="utf-8"
            )
        write_batch(first, last)
    if textless_pages:
        warnings.append(
            f"{textless_pages} PDF page(s) have no extracted text; inspect the visual batches rather than assuming they are empty."
        )
    if pptx:
        for slide in slides:
            body = f"# Slide {slide['number']}: {slide['title']}\n\n{slide['text']}\n\n## Speaker notes\n\n{slide['notes']}\n"
            (output / f"slide-{slide['number']:04d}.md").write_text(
                body, encoding="utf-8"
            )
    manifest = {
        "processor_version": 1,
        "format": "pptx" if pptx else "pdf",
        "page_count": page_count,
        "slide_count": len(slides),
        "slides_with_notes": sum(bool(slide["notes"]) for slide in slides),
        "text_characters": text_characters
        + sum(len(s["text"]) + len(s["notes"]) for s in slides),
        "textless_pages": textless_pages,
        "embedded_media_bytes": presentation.get("embedded_media_bytes", 0),
        "embedded_av_files": presentation.get("embedded_av_files", 0),
        "batches": batches,
        "warnings": warnings,
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-pages", type=int, default=1000)
    parser.add_argument("--batch-pages", type=int, default=8)
    parser.add_argument("--memory-mib", type=int, default=384)
    args = parser.parse_args()
    if (
        not 1 <= args.batch_pages <= 20
        or not 1 <= args.max_pages <= 2000
        or not 128 <= args.memory_mib <= 2048
    ):
        parser.error("Document resource limits are out of range.")
    resource.setrlimit(resource.RLIMIT_AS, (args.memory_mib * 1_048_576,) * 2)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    try:
        prepare_document(
            args.source,
            args.pdf,
            args.output,
            max_pages=args.max_pages,
            batch_pages=args.batch_pages,
        )
    except DocumentPreparationError as exc:
        (args.output.parent / "preparation-error.json").write_text(
            json.dumps({"error": str(exc)})
        )
        return 1
    except (
        zipfile.BadZipFile,
        KeyError,
        ElementTree.ParseError,
        PdfReadError,
        MemoryError,
        OSError,
        ValueError,
        RecursionError,
    ):
        # Exceptions can contain document bodies or signed-link content.
        print(
            "Document preparation failed: malformed/unsupported content or a resource limit was reached.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
