"""Per-run Confluence storage-body coverage, independent of connector registration."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ConfluenceReadState:
    """Per-run evidence coverage; a terminal chunk alone never proves a full read."""

    required_pages: set[str] = field(default_factory=set)
    reads: dict[str, dict[str, Any]] = field(default_factory=dict)
    errors: dict[str, str] = field(default_factory=dict)

    def record(self, page_id: str, result: dict[str, Any]) -> None:
        if result.get("is_error"):
            self.errors[page_id] = "Page body read failed"
            return
        try:
            payload = json.loads(result["content"][0]["text"])
            offset = payload["offset"]
            end = offset + len(payload["body"])
            total = payload["total_chars"]
            revision = payload["content_revision"]
        except (KeyError, IndexError, TypeError, ValueError):
            self.errors[page_id] = "Page body coverage metadata is missing"
            return
        previous = self.reads.get(page_id)
        if offset == 0:
            previous = {"revision": revision, "total": total, "ranges": []}
            self.reads[page_id] = previous
            self.errors.pop(page_id, None)
        if previous is None or previous["revision"] != revision or previous["total"] != total:
            self.errors[page_id] = "Continuation has no matching first chunk"
            return
        if not 0 <= offset <= end <= total:
            self.errors[page_id] = "Invalid page body range"
            return
        previous["ranges"].append((offset, end))

    def incomplete_pages(self) -> list[str]:
        incomplete = set(self.errors)
        for page_id in self.required_pages | set(self.reads):
            read = self.reads.get(page_id)
            if read is None:
                incomplete.add(page_id)
                continue
            covered = 0
            for start, end in sorted(read["ranges"]):
                if start > covered:
                    break
                covered = max(covered, end)
            if covered != read["total"]:
                incomplete.add(page_id)
        return sorted(incomplete)
