"""Private published-page views and native path/content retrieval.

The ingest mirror is never opened here. Each turn stages only an authenticated
published snapshot, exposes capability-limited reads, and removes it on exit.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
import shutil
import tempfile
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote

from tome_agent.agent import http_client
from tome_agent.orchestrator.contract import ChildProjectSnapshot, ProjectSnapshot

MAX_CORPUS_BYTES = 64 * 1024 * 1024
MAX_PAGE_BYTES = 8 * 1024 * 1024
MAX_PAGES = 20_000
MAX_CONTEXT_CHARACTERS = 128_000
MAX_INDEX_CHARACTERS = 32_000
MAX_SEARCH_MATCHES = 1_000


async def view_operation[Result](
    function: Callable[..., Result], *args: Any, **kwargs: Any
) -> Result:
    """Finish bounded file work before cancellation can remove the private view."""
    task = asyncio.create_task(asyncio.to_thread(function, *args, **kwargs))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        await task
        raise


CORE_PATHS = (
    "charter.md",
    "overview.md",
    "roadmap.md",
    "standup.md",
    "activity.md",
    "decisions.md",
    "architecture.md",
    "memory.md",
    "strategy.md",
    "KPIs.md",
)
_WORDS = re.compile(r"[\w-]{2,}", re.UNICODE)
_STOP_WORDS = frozenset(
    [
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "by",
        "can",
        "do",
        "for",
        "from",
        "give",
        "has",
        "have",
        "how",
        "i",
        "in",
        "is",
        "it",
        "me",
        "of",
        "on",
        "or",
        "our",
        "please",
        "read",
        "show",
        "summarize",
        "tell",
        "that",
        "the",
        "their",
        "these",
        "this",
        "to",
        "use",
        "we",
        "what",
        "when",
        "where",
        "which",
        "who",
        "with",
        "you",
        "your",
    ]
)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _terms(query: str) -> list[str]:
    return list(
        dict.fromkeys(
            term for term in _WORDS.findall(query.casefold()) if term not in _STOP_WORDS
        )
    )[:16]


def _glob(pattern: str) -> re.Pattern[str]:
    """Anchored POSIX glob: *, ?, and whole-segment **; no path traversal."""
    if (
        not pattern
        or len(pattern) > 512
        or pattern.startswith("/")
        or any(part in {"", ".", ".."} for part in pattern.split("/"))
        or any(char in pattern for char in "\\[]{}")
        or any(ord(char) < 32 for char in pattern)
    ):
        raise ValueError("Use a relative page glob with *, ? or **")
    expression = ""
    parts = pattern.split("/")
    for index, part in enumerate(parts):
        if part == "**":
            expression += "(?:[^/]+/)*" if index < len(parts) - 1 else ".*"
            continue
        if "**" in part:
            raise ValueError("** must occupy a whole path segment")
        expression += "".join(
            "[^/]*" if char == "*" else "[^/]" if char == "?" else re.escape(char)
            for char in part
        )
        if index < len(parts) - 1:
            expression += "/"
    return re.compile(f"^{expression}$")


def _safe_page_path(path: str) -> None:
    if (
        not path.endswith(".md")
        or len(path) > 1024
        or path.startswith("/")
        or "\\" in path
        or any(ord(char) < 32 for char in path)
        or any(part in {"", ".", ".."} for part in path.split("/"))
    ):
        raise ValueError("Invalid published Markdown path")


def _body(markdown: str) -> str:
    if markdown.startswith("---\n"):
        end = markdown.find("\n---", 4)
        if end >= 0:
            return markdown[end + 4 :].lstrip()
    return markdown


@dataclass(frozen=True)
class PublishedPage:
    entity: ChildProjectSnapshot
    path: str
    file: Path
    title: str
    headings: tuple[str, ...]
    characters: int
    lines: int
    content_hash: str
    revision_id: str | None
    updated_at: str | None
    captured_at: str

    def reference(self) -> dict[str, Any]:
        return {
            "project_slug": self.entity.slug,
            "path": self.path,
            "title": self.title,
            "headings": list(self.headings),
            "characters": self.characters,
            "lines": self.lines,
            "citation": f"/projects/{quote(self.entity.slug, safe='')}/tome/wiki/"
            + "/".join(quote(part, safe="") for part in self.path.split("/")),
            "content_hash": self.content_hash,
            "revision_id": self.revision_id,
            "updated_at": self.updated_at,
            "captured_at": self.captured_at,
        }


class SnapshotPreparationError(ValueError):
    """Safe preparation errors reported by the authenticated export endpoint."""


class PublishedCorpus:
    """One caller/conversation/turn's private read-only retrieval capability."""

    def __init__(self, actor_sub: str, snapshot: ProjectSnapshot) -> None:
        identity = hashlib.sha256(
            _json([actor_sub, snapshot.project_id]).encode()
        ).hexdigest()[:16]
        self.root = Path(tempfile.mkdtemp(prefix=f"tome-context-{identity}-")).resolve()
        self.entities = {entity.slug: entity for entity in snapshot.readable_projects}
        self.by_id = {
            entity.project_id: entity for entity in snapshot.readable_projects
        }
        self.pages: dict[tuple[str, str], PublishedPage] = {}
        self.by_file: dict[str, PublishedPage] = {}
        self.captured_at = ""
        self.corpus_hash = ""
        self.completed_at = ""
        self.total_bytes = 0
        self.index = ""
        self.navigation: dict[str, Any] = {}

    def close(self) -> None:
        shutil.rmtree(self.root)

    def _directory(self, entity: ChildProjectSnapshot) -> Path:
        # Hash the identity to prevent arbitrary database identifiers becoming paths.
        key = hashlib.sha256(entity.project_id.encode()).hexdigest()
        return self.root / "entities" / key

    def text(self, page: PublishedPage) -> str:
        resolved = page.file.resolve(strict=True)
        if page.file.is_symlink() or not resolved.is_relative_to(self.root):
            raise ValueError("Published page escaped the private view")
        return resolved.read_text(encoding="utf-8")

    async def prepare(self, actor_sub: str, scope_hash: str) -> None:
        header_seen = False
        done_seen = False
        digest = hashlib.sha256()
        async with asyncio.timeout(75):
            async for frame in http_client.stream_retrieval_snapshot(
                actor_sub, scope_hash, list(self.by_id)
            ):
                kind = frame.get("type")
                if done_seen:
                    raise ValueError("Unexpected data after published snapshot")
                if kind == "error":
                    safe_messages = {
                        "TOME_CONTEXT_TOO_LARGE": "The published corpus exceeds the retrieval limits. Reduce oversized published content or adjust the configured retrieval capacity.",
                        "TOME_SCOPE_CHANGED": "TOME access changed during preparation. Retry with current permissions.",
                        "TOME_PAGE_PATH_INVALID": "A published page has an unsupported path. Correct its path before retrying.",
                    }
                    raise SnapshotPreparationError(
                        safe_messages.get(
                            frame.get("code"),
                            "TOME context preparation failed; no partial snapshot was used.",
                        )
                    )
                if kind == "catalog":
                    if (
                        header_seen
                        or frame.get("version") != 1
                        or frame.get("scope_hash") != scope_hash
                    ):
                        raise ValueError("Invalid published snapshot catalog")
                    catalog = frame.get("catalog")
                    if not isinstance(catalog, list):
                        raise ValueError("Missing published snapshot catalog")
                    received = [
                        ChildProjectSnapshot.model_validate(item) for item in catalog
                    ]
                    if {item.project_id: item for item in received} != self.by_id:
                        raise ValueError(
                            "Published snapshot scope does not match this caller"
                        )
                    if len(received) != len(self.by_id) or len(self.entities) != len(
                        self.by_id
                    ):
                        raise ValueError("Ambiguous published entity identity")
                    captured_at = frame.get("captured_at")
                    if not isinstance(captured_at, str) or not captured_at:
                        raise ValueError("Missing snapshot capture time")
                    self.captured_at = captured_at
                    header_seen = True
                elif kind == "page" and header_seen:
                    self._stage(frame, digest)
                elif kind == "done" and header_seen:
                    if (
                        frame.get("scope_hash") != scope_hash
                        or frame.get("page_count") != len(self.pages)
                        or frame.get("total_bytes") != self.total_bytes
                        or frame.get("corpus_hash") != digest.hexdigest()
                    ):
                        raise ValueError("Incomplete published snapshot")
                    completed_at = frame.get("completed_at")
                    if not isinstance(completed_at, str) or not completed_at:
                        raise ValueError("Missing snapshot completion time")
                    self.completed_at = completed_at
                    self.corpus_hash = digest.hexdigest()
                    done_seen = True
                else:
                    raise ValueError("Invalid published snapshot sequence")
        if not done_seen:
            raise ValueError("Published snapshot ended before completion")
        # Do not assemble model context from a partially authorized snapshot.
        await http_client.fetch_retrieval(actor_sub, scope_hash, "scope", {})
        await view_operation(self._write_indexes)

    def _stage(self, frame: dict[str, Any], digest: Any) -> None:
        entity = self.by_id.get(frame.get("project_id"))
        path, markdown = frame.get("path"), frame.get("markdown")
        if (
            not entity
            or frame.get("project_slug") != entity.slug
            or not isinstance(path, str)
            or not isinstance(markdown, str)
        ):
            raise ValueError("Page is outside the caller's published scope")
        _safe_page_path(path)
        if (entity.slug, path) in self.pages:
            raise ValueError("Duplicate published page")
        encoded = markdown.encode("utf-8")
        self.total_bytes += len(encoded)
        if (
            len(encoded) > MAX_PAGE_BYTES
            or self.total_bytes > MAX_CORPUS_BYTES
            or len(self.pages) >= MAX_PAGES
        ):
            raise ValueError("Published corpus exceeds the private view limit")
        content_hash = hashlib.sha256(encoded).hexdigest()
        if frame.get("content_hash") != content_hash:
            raise ValueError("Published page integrity check failed")
        revision_id, updated_at = frame.get("revision_id"), frame.get("updated_at")
        captured_at = frame.get("captured_at")
        if not isinstance(captured_at, str) or not captured_at:
            raise ValueError("Missing page capture time")
        if any(
            value is not None and not isinstance(value, str)
            for value in (revision_id, updated_at)
        ):
            raise ValueError("Invalid published revision metadata")
        file = self._directory(entity) / "pages" / path
        file.parent.mkdir(parents=True, exist_ok=True)
        with file.open("xb") as output:
            output.write(encoded)
        file.chmod(0o400)
        headings = tuple(
            heading[:160]
            for heading in re.findall(r"^#{1,6}\s+(.+)$", markdown, flags=re.MULTILINE)[
                :12
            ]
        )
        frontmatter = (
            markdown[: markdown.find("\n---", 4)]
            if markdown.startswith("---\n")
            else ""
        )
        title_match = re.search(r"^title:\s*(.+)$", frontmatter, flags=re.MULTILINE)
        title = (
            title_match.group(1).strip("\"'")
            if title_match
            else headings[0]
            if headings
            else Path(path).stem
        )[:240]
        page = PublishedPage(
            entity,
            path,
            file,
            title,
            headings,
            len(markdown),
            len(markdown.splitlines()),
            content_hash,
            revision_id,
            updated_at,
            captured_at,
        )
        self.pages[(entity.slug, path)] = page
        self.by_file[str(file)] = page
        digest.update(
            _json([entity.project_id, path, content_hash, revision_id or ""]).encode()
        )

    def _write_indexes(self) -> None:
        records = []
        for entity in self.entities.values():
            pages = self.select(entity.slug)
            overview = next(
                (
                    page
                    for name in ("charter.md", "overview.md")
                    for page in pages
                    if page.path == name
                ),
                None,
            )
            body = _body(self.text(overview)) if overview else ""
            records.append(
                {
                    **entity.model_dump(),
                    "page_count": len(pages),
                    "core_pages": [
                        page.path for page in pages if page.path in CORE_PATHS
                    ],
                    "overview_path": overview.path if overview else None,
                    "overview_excerpt": body[:700],
                    "overview_citation": overview.reference()["citation"]
                    if overview
                    else None,
                    "overview_truncated": len(body) > 700,
                    "latest_page_update": max(
                        (page.updated_at or "" for page in pages), default=""
                    )
                    or None,
                }
            )
            directory = self._directory(entity)
            directory.mkdir(parents=True, exist_ok=True)
            (directory / "INDEX.md").write_text(
                "# Published page navigation\n"
                + "\n".join(_json(page.reference()) for page in pages),
                encoding="utf-8",
            )
            (directory / "INDEX.md").chmod(0o400)
        navigation = {
            "capture_started_at": self.captured_at,
            "capture_completed_at": self.completed_at,
            "total_entities": len(records),
            "entities_omitted": 0,
            "entities": records,
        }
        # Preserve the full catalog/hierarchy before allocating space to excerpts.
        # Store structured JSON in the prompt to avoid quoting an index a second time.
        for summary_limit in (700, 350, 175, 80, 0):
            for record in records:
                excerpt = record["overview_excerpt"]
                record["overview_truncated"] |= len(excerpt) > summary_limit
                record["overview_excerpt"] = excerpt[:summary_limit]
            navigation["overview_excerpt_limit"] = summary_limit
            if len(_json(navigation)) <= MAX_INDEX_CHARACTERS:
                break
        while records and len(_json(navigation)) > MAX_INDEX_CHARACTERS:
            records.pop()
            navigation["entities_omitted"] += 1
        self.navigation = navigation
        self.index = "# Authorized TOME navigation\n" + _json(navigation)
        (self.root / "INDEX.md").write_text(self.index, encoding="utf-8")
        (self.root / "INDEX.md").chmod(0o400)

    def select(
        self,
        project_slug: str | None = None,
        entity_type: str | None = None,
        pattern: str = "**/*.md",
    ) -> list[PublishedPage]:
        if project_slug is not None and project_slug not in self.entities:
            raise ValueError("Entity is unavailable")
        expression = _glob(pattern)
        return sorted(
            (
                page
                for page in self.pages.values()
                if (project_slug is None or page.entity.slug == project_slug)
                and (entity_type is None or page.entity.project_type == entity_type)
                and expression.fullmatch(page.path)
            ),
            key=lambda page: (page.entity.slug, page.path),
        )

    def list_projects(self, offset: int, limit: int) -> dict[str, Any]:
        entities = sorted(
            self.entities.values(),
            key=lambda entity: (entity.project_type, entity.slug),
        )
        return self._slice(
            [entity.model_dump() for entity in entities], offset, limit, "projects"
        )

    @staticmethod
    def _slice(items: list[Any], offset: int, limit: int, field: str) -> dict[str, Any]:
        end = offset + limit
        return {
            field: items[offset:end],
            "total": len(items),
            "offset": offset,
            "next_offset": end if end < len(items) else None,
        }

    def glob_pages(
        self,
        pattern: str,
        project_slug: str | None,
        entity_type: str | None,
        offset: int,
        limit: int,
    ) -> dict[str, Any]:
        return self._slice(
            [
                page.reference()
                for page in self.select(project_slug, entity_type, pattern)
            ],
            offset,
            limit,
            "matches",
        )

    def list_pages(self, project_slug: str, offset: int, limit: int) -> dict[str, Any]:
        result = self.glob_pages("**/*.md", project_slug, None, offset, limit)
        result["paths"] = [page["path"] for page in result["matches"]]
        return result

    def read_page(
        self,
        project_slug: str,
        path: str,
        offset: int,
        limit: int,
        start_line: int | None,
        end_line: int | None,
    ) -> dict[str, Any]:
        _safe_page_path(path)
        page = self.pages.get((project_slug, path))
        if not page:
            raise ValueError("Page is unavailable")
        text = self.text(page)
        if end_line is not None and start_line is None:
            start_line = 1
        if start_line is not None:
            if offset or end_line is not None and end_line < start_line:
                raise ValueError(
                    "Use either character offsets or an ordered line range"
                )
            lines = text.splitlines(keepends=True)
            offset = sum(len(line) for line in lines[: start_line - 1])
            end = (
                sum(len(line) for line in lines[:end_line])
                if end_line is not None
                else len(text)
            )
        else:
            end = len(text)
        content = text[offset : min(end, offset + limit)]
        return {
            **page.reference(),
            "markdown": content,
            "offset": offset,
            "total_characters": len(text),
            "start_line": text[:offset].count("\n") + 1,
            "truncated": offset + len(content) < end,
            "next_offset": offset + len(content)
            if offset + len(content) < end
            else None,
            "requested_end_offset": end,
        }

    def _snippet(
        self, page: PublishedPage, line: int, context_lines: int, query: str = ""
    ) -> dict[str, Any]:
        lines = self.text(page).splitlines()
        start = max(0, line - context_lines - 1)
        end = min(len(lines), line + context_lines)
        selected = lines[start:end]
        snippets = []
        for number, value in enumerate(selected, start + 1):
            # A long line must show the match, rather than only its first column.
            position = (
                value.casefold().find(query.casefold())
                if number == line and query
                else 0
            )
            column = max(0, position - 200) if len(value) > 1000 else 0
            snippets.append(value[column : column + 1000])
        snippet = "\n".join(snippets)[:6000]
        return {
            **page.reference(),
            "match_line": line,
            "start_line": start + 1,
            "end_line": end,
            "snippet": snippet,
            "snippet_truncated": any(len(value) > 1000 for value in selected)
            or len("\n".join(snippets)) > 6000,
        }

    def _keyword_matches(
        self, query: str, pages: list[PublishedPage], literal: bool, context_lines: int
    ) -> list[dict[str, Any]]:
        terms = _terms(query) if not literal else [query.casefold().strip()]
        if not terms or not terms[0]:
            raise ValueError("Search needs a nonempty query")
        candidates: list[tuple[PublishedPage, list[int], int]] = []
        frequencies: Counter[int] = Counter()
        for page in pages:
            text = self.text(page).casefold()
            counts = [min(text.count(term), 50) for term in terms]
            positions = [text.find(term) for term in terms if term in text]
            if positions:
                candidates.append(
                    (page, counts, text[: min(positions)].count("\n") + 1)
                )
                frequencies.update(index for index, count in enumerate(counts) if count)
        ranked: list[dict[str, Any]] = []
        for page, counts, line in candidates:
            title = f"{page.title} {page.path} {' '.join(page.headings)}".casefold()
            score = sum(
                (1 + math.log(count))
                * math.log(1 + (len(pages) + 1) / (frequencies[index] + 1))
                + (4 if term in title else 0)
                for index, (term, count) in enumerate(zip(terms, counts))
                if count
            )
            ranked.append(
                {
                    **self._snippet(page, line, context_lines, terms[0]),
                    "score": round(score, 4),
                }
            )
        return sorted(
            ranked,
            key=lambda match: (-match["score"], match["project_slug"], match["path"]),
        )

    async def _ripgrep_matches(
        self, query: str, pages: list[PublishedPage], context_lines: int
    ) -> tuple[list[dict[str, Any]], bool]:
        executable = shutil.which("rg")
        if not executable:
            raise FileNotFoundError("ripgrep unavailable")
        allowed = {str(page.file): page for page in pages}
        files = list(allowed)
        matches: list[dict[str, Any]] = []
        capped = False
        scanned_bytes = 0
        async with asyncio.timeout(8):
            # Bounded argv batches scan only the selected manifest, avoiding OS
            # argument limits and unrelated navigation/index matches.
            for offset in range(0, len(files), 128):
                process = await asyncio.create_subprocess_exec(
                    executable,
                    "--fixed-strings",
                    "--ignore-case",
                    "--text",
                    "--no-heading",
                    "--with-filename",
                    "--line-number",
                    "--null",
                    "--color",
                    "never",
                    "--max-count",
                    "3",
                    "--",
                    query,
                    *files[offset : offset + 128],
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL,
                    limit=MAX_PAGE_BYTES + 4096,
                )
                try:
                    assert process.stdout is not None
                    while line := await process.stdout.readline():
                        scanned_bytes += len(line)
                        if scanned_bytes > 8 * 1024 * 1024:
                            capped = True
                            break
                        file, separator, body = line.partition(b"\0")
                        number, colon, _ = body.partition(b":")
                        page = allowed.get(file.decode("utf-8"))
                        if (
                            not separator
                            or not colon
                            or not number.isdigit()
                            or not page
                        ):
                            raise ValueError("Invalid content search result")
                        matches.append(
                            self._snippet(page, int(number), context_lines, query)
                        )
                        if len(matches) >= MAX_SEARCH_MATCHES:
                            capped = True
                            break
                    if not capped:
                        await process.wait()
                        if process.returncode not in {0, 1}:
                            raise ValueError("Published content search failed")
                finally:
                    if process.returncode is None:
                        process.kill()
                        await process.wait()
                if capped:
                    break
        return matches, capped

    async def search_pages(
        self,
        query: str,
        mode: str,
        project_slug: str | None,
        entity_type: str | None,
        path_glob: str,
        context_lines: int,
        offset: int,
        limit: int,
    ) -> dict[str, Any]:
        query = query.strip()
        if not query:
            raise ValueError("Search needs a nonempty query")
        if mode == "literal" and any(char in query for char in "\r\n"):
            raise ValueError("Literal search accepts one line; use separate queries")
        pages = self.select(project_slug, entity_type, path_glob)
        capped = False
        engine = "keyword-ranking"
        if mode == "literal" and shutil.which("rg"):
            matches, capped = await self._ripgrep_matches(query, pages, context_lines)
            engine = "ripgrep"
        else:
            matches = await view_operation(
                self._keyword_matches, query, pages, mode == "literal", context_lines
            )
            if mode == "literal":
                engine = "literal-python"
        return {
            **self._slice(matches, offset, limit, "matches"),
            "engine": engine,
            "eligible_pages": len(pages),
            "truncated": capped,
            "coverage": "At most three matches per page"
            if engine == "ripgrep"
            else "One ranked excerpt per matching page",
        }

    def model_context(self, query: str) -> tuple[str, dict[str, Any]]:
        """Include the whole corpus when small; preserve broad context when large."""
        capacity = MAX_CONTEXT_CHARACTERS - len(_json(self.navigation)) - 2000
        pages = self.select()
        evidence: list[dict[str, Any]] = []
        included: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        used = 0

        def block_for(
            page: PublishedPage,
        ) -> tuple[dict[str, Any], dict[str, str], int]:
            block = {"source": page.reference(), "markdown": self.text(page)}
            reference = {"project_slug": page.entity.slug, "path": page.path}
            return block, reference, len(_json(block)) + len(_json(reference)) + 4

        full_blocks = []
        if (
            sum(page.characters + len(_json(page.reference())) + 80 for page in pages)
            <= capacity
        ):
            full_blocks = [(page, *block_for(page)) for page in pages]
        whole_corpus = (
            bool(full_blocks) and sum(item[3] for item in full_blocks) <= capacity
        )
        if whole_corpus:
            passes = [(pages, capacity)]
        else:
            ranked = (
                self._keyword_matches(query, pages, False, 0) if _terms(query) else []
            )
            relevant = [
                self.pages[(match["project_slug"], match["path"])]
                for match in ranked[:20]
            ]
            charters = sorted(
                (page for page in pages if page.path in {"charter.md", "overview.md"}),
                key=lambda page: (
                    page.entity.project_type != "bhag",
                    page.entity.project_type != "area",
                    page.entity.slug,
                    page.path,
                ),
            )
            core = sorted(
                (page for page in pages if page.path in CORE_PATHS),
                key=lambda page: (CORE_PATHS.index(page.path), page.entity.slug),
            )
            # Preserve broad foundations, then use the remaining budget for the
            # question and supporting progress/decision/memory documents.
            passes = [(charters, capacity // 3), (relevant, capacity), (core, capacity)]
        for candidates, budget in passes:
            for page in candidates:
                key = (page.entity.slug, page.path)
                if key in seen:
                    continue
                block, reference, size = block_for(page)
                if used + size > budget:
                    continue
                evidence.append(block)
                included.append(reference)
                seen.add(key)
                used += size
        coverage = {
            "entities": len(self.entities),
            "published_pages": len(pages),
            "corpus_bytes": self.total_bytes,
            "preloaded_complete_pages": len(included),
            "preloaded_pages": included,
            "full_corpus_in_context": len(included) == len(pages),
            "navigation_truncated": bool(self.navigation.get("entities_omitted")),
            "overview_excerpt_limit": self.navigation.get("overview_excerpt_limit"),
            "remaining_pages_available_via_search_and_read": len(pages) - len(included),
            "capture_started_at": self.captured_at,
            "capture_completed_at": self.completed_at,
            "corpus_hash": self.corpus_hash,
        }
        context = _json(
            {
                "coverage": coverage,
                "navigation_index": self.navigation,
                "published_document_reference": evidence,
            }
        )
        if len(context) > MAX_CONTEXT_CHARACTERS:
            raise ValueError("Published model context exceeds its limit")
        return context, coverage
