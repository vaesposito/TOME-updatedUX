"""In-process MCP server exposing the GitHub REST API to the ingest agent.

Wraps the same httpx-based fetch code that powers the static GithubConnector,
but as MCP tools the Claude Agent SDK can call. Runs in-process — no
subprocess, no Docker.

Tools returned by `build_github_mcp(repos, token)`:
  github_list_commits(repo, since)
  github_list_releases(repo)
  github_list_issues(repo, since, state, label?)
  github_get_issue(repo, number)
  github_list_issue_comments(repo, number)
  github_search_issues(query)            — GitHub search syntax
  github_list_pulls(repo, since, state)
  github_get_pr(repo, number)
  github_get_codeowners(repo)
  github_get_file(repo, path, ref)       — first 16,000 chars of a file
  github_get_file_chunk(repo, path, ref, offset, limit) — bounded file slice
  github_list_dir(repo, path, ref)       — directory listing
  github_get_readme(repo, ref)           — repo README (any variant)
  github_list_milestones(repo, state)    — due dates, open/closed issue counts
  github_get_milestone(repo, number)
  github_list_projects(repo)             — Projects v2 boards linked to the repo (GraphQL)
  github_list_project_items(repo, project_number) — board items + status/custom fields (GraphQL)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from functools import partial
from typing import Any

import httpx
from claude_agent_sdk import create_sdk_mcp_server, tool

from tome_agent.agent.connectors.base import record_fetch

API = "https://api.github.com"
DEFAULT_PER_PAGE = 30

# Identifier-shaped args kept verbatim in the fetch ledger; anything else
# (currently just `search_issues`' free-text `query`) is redacted — see
# connectors/base.py's redact_tool_args().
_GITHUB_ALLOWED_ARGS = frozenset(
    {"repo", "since", "state", "number", "path", "ref", "offset", "limit", "project_number"}
)


def _github_canonical_uri(tool_name: str, args: dict[str, Any]) -> str:
    """Best-effort identifier for what a GitHub tool call fetched. Listing
    tools (no single-item id) get a collection-scoped URI; item tools get an
    item-scoped one."""
    repo = args.get("repo") or "unknown-repo"
    ref = (args.get("ref") or "").strip() or "HEAD"
    if tool_name in ("github_get_file", "github_get_file_chunk"):
        return f"github://{repo}/blob/{ref}/{args.get('path', '')}"
    if tool_name == "github_list_dir":
        return f"github://{repo}/tree/{ref}/{args.get('path', '')}"
    if tool_name == "github_get_readme":
        return f"github://{repo}/readme/{ref}"
    if tool_name == "github_get_codeowners":
        return f"github://{repo}/codeowners"
    if tool_name in ("github_get_issue", "github_list_issue_comments"):
        return f"github://{repo}/issues/{args.get('number')}"
    if tool_name == "github_get_pr":
        return f"github://{repo}/pulls/{args.get('number')}"
    if tool_name == "github_get_milestone":
        return f"github://{repo}/milestones/{args.get('number')}"
    if tool_name == "github_list_project_items":
        return f"github://{repo}/projects/{args.get('project_number')}"
    if tool_name == "github_search_issues":
        query_hash = hashlib.sha256((args.get("query") or "").encode("utf-8")).hexdigest()[:16]
        return f"github://search/issues?q_hash={query_hash}"
    # list_commits / list_releases / list_issues / list_pulls / list_milestones / list_projects
    suffix = tool_name.removeprefix("github_list_").removeprefix("github_")
    return f"github://{repo}/{suffix}"


_record_fetch = partial(
    record_fetch,
    connector="github",
    allowed_arg_keys=_GITHUB_ALLOWED_ARGS,
    canonical_uri=_github_canonical_uri,
)


def _normalize_repo(repo: str, allowed: set[str]) -> str | None:
    """Map any flavor of repo identifier to the canonical `owner/name` form,
    rejecting anything not in the allowlist. Returns None if not allowed."""
    s = repo.strip().rstrip("/")
    if s.startswith("https://github.com/"):
        s = s[len("https://github.com/") :]
    elif s.startswith("github.com/"):
        s = s[len("github.com/") :]
    if s.endswith(".git"):
        s = s[: -len(".git")]
    parts = s.split("/")
    if len(parts) < 2:
        return None
    canonical = f"{parts[0]}/{parts[1]}"
    return canonical if canonical in allowed else None


def _ok(payload: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}]}


def _err(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "is_error": True}


def build_github_mcp(repos: list[str], token: str = ""):
    """Create the MCP server with tools scoped to `repos` for safety."""

    # Canonicalize the project's repo allowlist once.
    allowed: set[str] = set()
    for r in repos:
        canonical = _normalize_repo(r, allowed=set([f"{r}"]))  # bypass; we're seeding allowlist
        s = r.strip().rstrip("/")
        if s.startswith("https://github.com/"):
            s = s[len("https://github.com/") :]
        elif s.startswith("github.com/"):
            s = s[len("github.com/") :]
        if s.endswith(".git"):
            s = s[: -len(".git")]
        parts = s.split("/")
        if len(parts) >= 2:
            allowed.add(f"{parts[0]}/{parts[1]}")
        if canonical:  # placate linter (unused-var would otherwise nag)
            pass

    def _headers() -> dict[str, str]:
        h = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "ttt-ingest-agent",
        }
        if token:
            h["Authorization"] = f"Bearer {token}"
        return h

    async def _get(path: str, params: dict[str, Any] | None = None) -> Any:
        async with httpx.AsyncClient(timeout=20.0, headers=_headers()) as client:
            for attempt in range(3):
                resp = await client.get(f"{API}{path}", params=params)
                if resp.status_code != 429 or attempt == 2:
                    resp.raise_for_status()
                    return resp.json()
                wait = int(resp.headers.get("Retry-After", "5"))
                await asyncio.sleep(min(wait, 60))

    async def _graphql(query: str, variables: dict[str, Any]) -> Any:
        """Projects v2 has no REST endpoint — GraphQL is the only path."""
        async with httpx.AsyncClient(timeout=20.0, headers=_headers()) as client:
            for attempt in range(3):
                resp = await client.post(
                    f"{API}/graphql", json={"query": query, "variables": variables}
                )
                if resp.status_code != 429 or attempt == 2:
                    resp.raise_for_status()
                    body = resp.json()
                    if body.get("errors"):
                        raise RuntimeError(
                            "; ".join(e.get("message", "") for e in body["errors"])
                        )
                    return body.get("data")
                wait = int(resp.headers.get("Retry-After", "5"))
                await asyncio.sleep(min(wait, 60))

    @tool(
        "github_list_commits",
        "List commits on a repo. `since` is RFC3339 (e.g. 2026-04-01T00:00:00Z).",
        {"repo": str, "since": str},
    )
    @_record_fetch(tool_name="github_list_commits")
    async def list_commits(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist: {sorted(allowed)}")
        try:
            data = await _get(
                f"/repos/{repo}/commits",
                {"since": args["since"], "per_page": DEFAULT_PER_PAGE},
            )
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = [
            {
                "sha": (c.get("sha") or "")[:7],
                "date": ((c.get("commit") or {}).get("author") or {}).get("date", "")[:10],
                "author": ((c.get("commit") or {}).get("author") or {}).get("name", ""),
                "login": (c.get("author") or {}).get("login") if c.get("author") else None,
                "message": ((c.get("commit") or {}).get("message") or "").splitlines()[0][:200],
            }
            for c in data
        ]
        return _ok(out)

    @tool(
        "github_list_releases",
        "List releases on a repo, newest first.",
        {"repo": str},
    )
    @_record_fetch(tool_name="github_list_releases")
    async def list_releases(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        try:
            data = await _get(f"/repos/{repo}/releases", {"per_page": DEFAULT_PER_PAGE})
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = [
            {
                "tag": r.get("tag_name") or r.get("name"),
                "name": r.get("name"),
                "created_at": r.get("created_at"),
                "published_at": r.get("published_at"),
                "author": (r.get("author") or {}).get("login"),
                "body_excerpt": (r.get("body") or "").strip().splitlines()[:1],
                "prerelease": r.get("prerelease"),
            }
            for r in data
        ]
        return _ok(out)

    @tool(
        "github_list_issues",
        "List issues on a repo (excludes PRs). `since` RFC3339, `state` open|closed|all.",
        {"repo": str, "since": str, "state": str},
    )
    @_record_fetch(tool_name="github_list_issues")
    async def list_issues(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        try:
            data = await _get(
                f"/repos/{repo}/issues",
                {
                    "since": args["since"],
                    "state": args.get("state", "all"),
                    "per_page": DEFAULT_PER_PAGE * 2,
                },
            )
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        # Filter out PRs (the /issues endpoint returns both)
        issues = [it for it in data if not it.get("pull_request")]
        out = [_summarize_issue(it) for it in issues]
        return _ok(out)

    @tool(
        "github_get_issue",
        "Get a single issue with body, labels, assignees, and recent comments count.",
        {"repo": str, "number": int},
    )
    @_record_fetch(tool_name="github_get_issue")
    async def get_issue(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        try:
            it = await _get(f"/repos/{repo}/issues/{args['number']}")
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = _summarize_issue(it)
        out["body"] = (it.get("body") or "").strip()[:2000]
        out["comments"] = it.get("comments", 0)
        return _ok(out)

    @tool(
        "github_list_issue_comments",
        "List recent comments for a single issue. Fetch only after the compact issue index identifies a relevant issue.",
        {"repo": str, "number": int},
    )
    @_record_fetch(tool_name="github_list_issue_comments")
    async def list_issue_comments(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        try:
            data = await _get(
                f"/repos/{repo}/issues/{args['number']}/comments",
                {"per_page": DEFAULT_PER_PAGE},
            )
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        return _ok(
            [
                {
                    "author": (comment.get("user") or {}).get("login"),
                    "created_at": comment.get("created_at"),
                    "updated_at": comment.get("updated_at"),
                    "body": (comment.get("body") or "").strip()[:2000],
                    "url": comment.get("html_url"),
                }
                for comment in data
            ]
        )

    @tool(
        "github_list_pulls",
        "List pull requests on a repo. `state` open|closed|all.",
        {"repo": str, "state": str},
    )
    @_record_fetch(tool_name="github_list_pulls")
    async def list_pulls(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        try:
            data = await _get(
                f"/repos/{repo}/pulls",
                {
                    "state": args.get("state", "all"),
                    "per_page": DEFAULT_PER_PAGE,
                    "sort": "updated",
                    "direction": "desc",
                },
            )
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = [
            {
                "number": p.get("number"),
                "title": p.get("title"),
                "state": p.get("state"),
                "merged": bool(p.get("merged_at")),
                "author": (p.get("user") or {}).get("login"),
                "updated_at": p.get("updated_at", "")[:10],
                "labels": [(lb.get("name") or "") for lb in (p.get("labels") or [])],
            }
            for p in data
        ]
        return _ok(out)

    @tool(
        "github_get_pr",
        "Get a PR with reviewers, requested reviewers, merge state.",
        {"repo": str, "number": int},
    )
    @_record_fetch(tool_name="github_get_pr")
    async def get_pr(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        try:
            pr = await _get(f"/repos/{repo}/pulls/{args['number']}")
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = {
            "number": pr.get("number"),
            "title": pr.get("title"),
            "state": pr.get("state"),
            "merged": pr.get("merged"),
            "merged_at": pr.get("merged_at"),
            "author": (pr.get("user") or {}).get("login"),
            "requested_reviewers": [u.get("login") for u in (pr.get("requested_reviewers") or [])],
            "labels": [(lb.get("name") or "") for lb in (pr.get("labels") or [])],
            "body_excerpt": (pr.get("body") or "").strip()[:2000],
            "additions": pr.get("additions"),
            "deletions": pr.get("deletions"),
            "changed_files": pr.get("changed_files"),
        }
        return _ok(out)

    @tool(
        "github_search_issues",
        "Run a GitHub issue search. Use full GH search syntax. Scoped to project repos automatically.",
        {"query": str},
    )
    @_record_fetch(tool_name="github_search_issues")
    async def search_issues(args: dict) -> dict[str, Any]:
        # Scope to project repos so the agent can't fish across all of GH.
        scope = " ".join(f"repo:{r}" for r in sorted(allowed))
        full_query = f"{args['query']} {scope}".strip()
        try:
            data = await _get(
                "/search/issues",
                {"q": full_query, "per_page": DEFAULT_PER_PAGE, "sort": "updated"},
            )
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = [_summarize_issue(it) for it in (data.get("items") or [])]
        return _ok({"total_count": data.get("total_count"), "items": out})

    @tool(
        "github_get_codeowners",
        "Read CODEOWNERS for a repo (tries .github/CODEOWNERS, CODEOWNERS, docs/CODEOWNERS).",
        {"repo": str},
    )
    @_record_fetch(tool_name="github_get_codeowners")
    async def get_codeowners(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        for path in (".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"):
            try:
                async with httpx.AsyncClient(timeout=15.0, headers={**_headers(), "Accept": "application/vnd.github.raw"}) as client:
                    resp = await client.get(f"{API}/repos/{repo}/contents/{path}")
                    if resp.status_code == 200:
                        return _ok({"path": path, "content": resp.text})
            except Exception:
                continue
        return _err("no CODEOWNERS file found")

    @tool(
        "github_get_file",
        "Read a file from a repo at `path` (no leading slash). Optional `ref` is a branch/tag/sha; defaults to the repo's default branch. Returns up to 16,000 characters. If `truncated` is true, continue with `github_get_file_chunk` using `next_offset`.",
        {"repo": str, "path": str, "ref": str},
    )
    @_record_fetch(tool_name="github_get_file")
    async def get_file(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        path = (args.get("path") or "").lstrip("/")
        if not path:
            return _err("path is required")
        ref = (args.get("ref") or "").strip()
        params = {"ref": ref} if ref else None
        try:
            async with httpx.AsyncClient(
                timeout=20.0,
                headers={**_headers(), "Accept": "application/vnd.github.raw"},
            ) as client:
                resp = await client.get(
                    f"{API}/repos/{repo}/contents/{path}", params=params
                )
                if resp.status_code == 404:
                    return _err(f"not found: {repo}:{path}" + (f"@{ref}" if ref else ""))
                resp.raise_for_status()
                text = resp.text
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        max_bytes = 2_000_000
        if len(text.encode("utf-8", errors="ignore")) > max_bytes:
            return _err("file exceeds 2MB; use github_list_dir or a more specific source file")
        chunk_size = 16_000
        truncated = len(text) > chunk_size
        return _ok(
            {
                "path": path,
                "ref": ref or None,
                "content": text[:chunk_size],
                "total_chars": len(text),
                "truncated": truncated,
                "next_offset": chunk_size if truncated else None,
                "hint": (
                    "Continue with github_get_file_chunk at next_offset."
                    if truncated
                    else None
                ),
            }
        )

    @tool(
        "github_get_file_chunk",
        "Read the next bounded slice of a GitHub file. Pass the same `repo`, `path`, and `ref` used for `github_get_file`; `offset` is a character offset (use the previous response's `next_offset`), and `limit` must be 1–8,000. Use an empty `ref` for the default branch. Repeat until `next_offset` is null.",
        {"repo": str, "path": str, "ref": str, "offset": int, "limit": int},
    )
    @_record_fetch(tool_name="github_get_file_chunk")
    async def get_file_chunk(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args.get("repo", ""), allowed)
        if not repo:
            return _err(f"repo {args.get('repo')!r} not in this project's allowlist")
        path = (args.get("path") or "").lstrip("/")
        if not path:
            return _err("path is required")
        try:
            offset = int(args.get("offset"))
            limit = int(args.get("limit"))
        except (TypeError, ValueError):
            return _err("offset and limit must be integers")
        if offset < 0:
            return _err("offset must be zero or greater")
        if not 1 <= limit <= 8_000:
            return _err("limit must be between 1 and 8000 characters")

        ref = (args.get("ref") or "").strip()
        params = {"ref": ref} if ref else None
        try:
            async with httpx.AsyncClient(
                timeout=20.0,
                headers={**_headers(), "Accept": "application/vnd.github.raw"},
            ) as client:
                resp = await client.get(
                    f"{API}/repos/{repo}/contents/{path}", params=params
                )
                if resp.status_code == 404:
                    return _err(f"not found: {repo}:{path}" + (f"@{ref}" if ref else ""))
                resp.raise_for_status()
                text = resp.text
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        max_bytes = 2_000_000
        if len(text.encode("utf-8", errors="ignore")) > max_bytes:
            return _err("file exceeds 2MB; use github_list_dir or a more specific source file")

        chunk = text[offset : offset + limit]
        next_offset = offset + len(chunk)
        return _ok(
            {
                "path": path,
                "ref": ref or None,
                "offset": offset,
                "content": chunk,
                "total_chars": len(text),
                "next_offset": next_offset if next_offset < len(text) else None,
            }
        )

    @tool(
        "github_list_dir",
        "List entries in a repo directory. `path` empty = repo root. Returns name, path, type (file|dir|symlink|submodule), size.",
        {"repo": str, "path": str, "ref": str},
    )
    @_record_fetch(tool_name="github_list_dir")
    async def list_dir(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        path = (args.get("path") or "").strip().lstrip("/")
        ref = (args.get("ref") or "").strip()
        params = {"ref": ref} if ref else None
        try:
            data = await _get(f"/repos/{repo}/contents/{path}", params)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return _err(f"not found: {repo}:{path or '/'}" + (f"@{ref}" if ref else ""))
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        if not isinstance(data, list):
            return _err(f"{path or '/'} is not a directory")
        out = [
            {
                "name": e.get("name"),
                "path": e.get("path"),
                "type": e.get("type"),
                "size": e.get("size"),
            }
            for e in data
        ]
        return _ok(out)

    @tool(
        "github_get_readme",
        "Get the repo README (any variant: README.md, README.rst, etc.).",
        {"repo": str, "ref": str},
    )
    @_record_fetch(tool_name="github_get_readme")
    async def get_readme(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        ref = (args.get("ref") or "").strip()
        params = {"ref": ref} if ref else None
        try:
            async with httpx.AsyncClient(
                timeout=20.0,
                headers={**_headers(), "Accept": "application/vnd.github.raw"},
            ) as client:
                resp = await client.get(f"{API}/repos/{repo}/readme", params=params)
                if resp.status_code == 404:
                    return _err(f"no README found for {repo}")
                resp.raise_for_status()
                return _ok({"ref": ref or None, "content": resp.text})
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")

    @tool(
        "github_list_milestones",
        "List milestones on a repo — due dates, open/closed issue counts, descriptions. `state` open|closed|all.",
        {"repo": str, "state": str},
    )
    @_record_fetch(tool_name="github_list_milestones")
    async def list_milestones(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        try:
            data = await _get(
                f"/repos/{repo}/milestones",
                {"state": args.get("state", "all"), "per_page": DEFAULT_PER_PAGE},
            )
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = [_summarize_milestone(m) for m in data]
        return _ok(out)

    @tool(
        "github_get_milestone",
        "Get a single milestone with its full description.",
        {"repo": str, "number": int},
    )
    @_record_fetch(tool_name="github_get_milestone")
    async def get_milestone(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        try:
            m = await _get(f"/repos/{repo}/milestones/{args['number']}")
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = _summarize_milestone(m)
        out["description"] = (m.get("description") or "").strip()
        return _ok(out)

    @tool(
        "github_list_projects",
        "List GitHub Projects (v2) boards linked to a repo — the actual planning surface, not just issues that happen to be on one. Use `github_list_project_items` with the returned `number` to read a board's items.",
        {"repo": str},
    )
    @_record_fetch(tool_name="github_list_projects")
    async def list_projects(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        owner, name = repo.split("/", 1)
        query = """
        query($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            projectsV2(first: 20) {
              nodes { number title url shortDescription closed }
            }
          }
        }
        """
        try:
            data = await _graphql(query, {"owner": owner, "name": name})
        except (httpx.HTTPStatusError, RuntimeError) as e:
            return _err(f"GraphQL error: {e}")
        nodes = ((data or {}).get("repository") or {}).get("projectsV2", {}).get("nodes", [])
        return _ok(nodes)

    @tool(
        "github_list_project_items",
        "List items on a repo-linked Projects (v2) board — status/column, custom fields (priority, etc.), and the linked issue/PR. Get `project_number` from `github_list_projects`.",
        {"repo": str, "project_number": int},
    )
    @_record_fetch(tool_name="github_list_project_items")
    async def list_project_items(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        owner, name = repo.split("/", 1)
        query = """
        query($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            projectV2(number: $number) {
              title
              items(first: 100) {
                nodes {
                  fieldValues(first: 10) {
                    nodes {
                      ... on ProjectV2ItemFieldSingleSelectValue {
                        name
                        field { ... on ProjectV2FieldCommon { name } }
                      }
                      ... on ProjectV2ItemFieldTextValue {
                        text
                        field { ... on ProjectV2FieldCommon { name } }
                      }
                      ... on ProjectV2ItemFieldDateValue {
                        date
                        field { ... on ProjectV2FieldCommon { name } }
                      }
                    }
                  }
                  content {
                    ... on Issue { number title state url }
                    ... on PullRequest { number title state url }
                    ... on DraftIssue { title }
                  }
                }
              }
            }
          }
        }
        """
        try:
            data = await _graphql(
                query, {"owner": owner, "name": name, "number": args["project_number"]}
            )
        except (httpx.HTTPStatusError, RuntimeError) as e:
            return _err(f"GraphQL error: {e}")
        project = ((data or {}).get("repository") or {}).get("projectV2")
        if not project:
            return _err(f"project #{args['project_number']} not found on {repo}")
        items = []
        for node in project.get("items", {}).get("nodes", []):
            fields = {
                fv["field"]["name"]: fv.get("name") or fv.get("text") or fv.get("date")
                for fv in node.get("fieldValues", {}).get("nodes", [])
                if fv.get("field")
            }
            items.append({"content": node.get("content"), "fields": fields})
        return _ok({"title": project.get("title"), "items": items})

    return create_sdk_mcp_server(
        name="github",
        version="0.1.0",
        tools=[
            list_commits,
            list_releases,
            list_issues,
            get_issue,
            list_issue_comments,
            list_pulls,
            get_pr,
            search_issues,
            get_codeowners,
            get_file,
            get_file_chunk,
            list_dir,
            get_readme,
            list_milestones,
            get_milestone,
            list_projects,
            list_project_items,
        ],
    )


def _summarize_issue(it: dict[str, Any]) -> dict[str, Any]:
    return {
        "number": it.get("number"),
        "title": it.get("title"),
        "state": it.get("state"),
        "author": (it.get("user") or {}).get("login"),
        "labels": [(lb.get("name") or "") for lb in (it.get("labels") or [])],
        "assignees": [(u.get("login") or "") for u in (it.get("assignees") or [])],
        "updated_at": (it.get("updated_at") or "")[:10],
        "url": it.get("html_url"),
    }


def _summarize_milestone(m: dict[str, Any]) -> dict[str, Any]:
    return {
        "number": m.get("number"),
        "title": m.get("title"),
        "state": m.get("state"),
        "due_on": m.get("due_on"),
        "open_issues": m.get("open_issues"),
        "closed_issues": m.get("closed_issues"),
        "url": m.get("html_url"),
    }
