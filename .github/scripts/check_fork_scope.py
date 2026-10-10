"""Verify upstream imports without checking out or executing PR content."""

from __future__ import annotations

import html
import json
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath


UPSTREAM_URL = "https://github.com/caipe-io/ai-platform-engineering"
UPSTREAM_REF = "refs/remotes/upstream-scope/main"
ALLOWED_PREFIXES = ("ui/", "ai_platform_engineering/agents/tome/", "docs/")
ALLOWED_FILES = (
  ".github/workflows/check-fork-scope.yml",
  ".github/scripts/check_fork_scope.py",
  ".github/workflows/release-all-manual.yml",
  ".github/workflows/ci-mcp-servers.yml",
  ".github/workflows/ci-rag.yml",
  "build/Dockerfile.caipe-ui",
)
SHA = re.compile(r"[0-9a-f]{40}\Z")
IMPORT_MARKER = re.compile(r"^\(cherry picked from commit ([0-9a-f]{40})\)$", re.MULTILINE)


class VerificationError(Exception):
  """An import cannot be proven clean, or the history cannot be inspected."""


class Git:
  def __init__(self, repo: Path, env: dict[str, str] | None = None) -> None:
    self.repo = repo
    self.env = {
      **os.environ,
      "GIT_CONFIG_NOSYSTEM": "1",
      "GIT_CONFIG_GLOBAL": os.devnull,
      "GIT_NO_REPLACE_OBJECTS": "1",
      "GIT_TERMINAL_PROMPT": "0",
      "LC_ALL": "C",
      **(env or {}),
    }

  def run(self, *args: str, data: bytes | None = None, check: bool = True) -> subprocess.CompletedProcess[bytes]:
    result = subprocess.run(
      ["git", "-c", f"core.hooksPath={os.devnull}", "-c", "apply.ignoreWhitespace=false", *args],
      cwd=self.repo, env=self.env, input=data, capture_output=True, timeout=120,
    )
    if check and result.returncode:
      raise VerificationError(f"Git {args[0]} failed: {result.stderr.decode('utf-8', errors='replace').strip()}")
    return result

  def text(self, *args: str) -> str:
    return self.run(*args).stdout.decode("utf-8", errors="replace").strip()

  def parents(self, commit: str) -> list[str]:
    return self.text("rev-list", "--parents", "-n", "1", commit).split()[1:]

  def changed_paths(self, parent: str, commit: str) -> list[str]:
    changed = self.run("diff", "--name-only", "--no-renames", "-z", parent, commit, "--").stdout
    return [os.fsdecode(path) for path in changed.split(b"\0") if path]

  def patch(self, parent: str, commit: str, *, paths: list[str] | None = None) -> bytes:
    if paths == []:
      return b""
    return self.run(
      "diff", "--binary", "--full-index", "--find-renames",
      "--no-ext-diff", "--no-textconv", parent, commit, "--",
      *(f":(top,literal){path}" for path in paths or ()),
    ).stdout

  def file_delta(self, parent: str, commit: str, path: str) -> bytes:
    patch = self.run(
      "diff", "--binary", "--full-index", "--no-renames", "--unified=0",
      "--no-ext-diff", "--no-textconv", parent, commit, "--", f":(top,literal){path}",
    ).stdout
    # Compare changed content/modes, not blob IDs, line positions, or the
    # unchanged fork context. Differences are review notes, not failures.
    return b"\n".join(
      re.sub(rb"^@@ -[0-9]+(?:,[0-9]+)? \+[0-9]+(?:,[0-9]+)? @@.*$", b"@@", line)
      for line in patch.splitlines()
      if not re.fullmatch(rb"index [0-9a-f]+\.\.[0-9a-f]+(?: [0-7]+)?", line)
    )

  def apply(self, tree: str, patch: bytes) -> str:
    self.run("read-tree", tree)
    if patch:
      result = self.run("apply", "--cached", "--3way", "--whitespace=nowarn", data=patch, check=False)
      if result.returncode:
        raise VerificationError("Cannot separate imported changes from other fork edits in the restricted-path baseline.")
    return self.text("write-tree")


@dataclass
class Result:
  imports: list[tuple[str, str]] = field(default_factory=list)
  adaptations: list[tuple[str, str]] = field(default_factory=list)
  errors: list[str] = field(default_factory=list)
  violations: list[str] = field(default_factory=list)
  fork_commits: int = 0

  @property
  def failed(self) -> bool:
    return bool(self.errors or self.violations)


def is_allowed(path: str) -> bool:
  return path.startswith(ALLOWED_PREFIXES) or path in ALLOWED_FILES


def markers(message: str) -> list[str]:
  found = IMPORT_MARKER.findall(message)
  # A malformed or squashed marker must not silently downgrade to a fork commit.
  candidates = [line for line in message.splitlines() if line.startswith("(cherry picked from commit")]
  if len(candidates) != len(found) or len(found) > 1:
    raise VerificationError("Expected exactly one full-SHA cherry-pick -x marker per import commit; do not squash imports.")
  return found


def check_scope(repo: Path, base: str, head: str, upstream_ref: str = UPSTREAM_REF) -> Result:
  result = Result()
  git = Git(repo)
  if not SHA.fullmatch(base) or not SHA.fullmatch(head):
    raise VerificationError("PR base and head must be full commit SHAs.")
  merge_bases = git.text("merge-base", "--all", base, head).splitlines()
  if len(merge_bases) != 1:
    raise VerificationError("PR history must have a single merge base.")
  merge_base = merge_bases[0]
  restricted_paths = {path for path in git.changed_paths(merge_base, head) if not is_allowed(path)}
  commits = git.text("rev-list", "--reverse", "--topo-order", head, f"^{base}").splitlines()
  claims: list[tuple[str, str]] = []
  for commit in commits:
    try:
      parents = git.parents(commit)
      # Allowed-only commits need no upstream provenance, even if they retain
      # an import marker. Keep allowed fork changes out of import validation.
      if parents and all(is_allowed(path) for path in git.changed_paths(parents[0], commit)):
        result.fork_commits += 1
        continue
      sources = markers(git.text("show", "-s", "--format=%B", commit))
      if sources:
        claims.append((commit, sources[0]))
      else:
        result.fork_commits += 1
    except VerificationError as error:
      result.errors.append(f"{commit[:12]}: {error}")

  # The official ref is fetched by the trusted workflow, never chosen by the PR.
  upstream_tip = git.text("rev-parse", "--verify", f"{upstream_ref}^{{commit}}") if claims else None
  object_dir = git.text("rev-parse", "--path-format=absolute", "--git-path", "objects")
  with tempfile.TemporaryDirectory(prefix="fork-scope-") as scratch:
    directory = Path(scratch)
    git.run("init", "--bare", "--template=", str(directory / "replay.git"))
    replay = Git(repo, {
      "GIT_DIR": str(directory / "replay.git"),
      "GIT_INDEX_FILE": str(directory / "replay.index"),
      "GIT_ALTERNATE_OBJECT_DIRECTORIES": object_dir,
    })
    expected = merge_base
    for commit, source in claims:
      try:
        kind = git.run("cat-file", "-t", source, check=False)
        if kind.returncode or kind.stdout.strip() != b"commit":
          raise VerificationError(f"Source {source} is not available in official upstream main.")
        ancestry = git.run("merge-base", "--is-ancestor", source, str(upstream_tip), check=False)
        if ancestry.returncode:
          raise VerificationError(f"Source {source} is not an ancestor of official upstream main.")
        parents, source_parents = git.parents(commit), git.parents(source)
        if len(parents) != 1:
          raise VerificationError("Import commits must have one parent; import upstream merges with cherry-pick -x -m 1.")
        if not source_parents:
          raise VerificationError("Importing an upstream root commit is not supported.")
        # Upstream merges use first-parent/mainline 1, matching cherry-pick -m 1.
        # Verify provenance and the actual file subset. Upstream conflicts do
        # not disqualify an import; changed file deltas are shown for review.
        selected_paths = [path for path in git.changed_paths(parents[0], commit) if not is_allowed(path)]
        if not selected_paths:
          raise VerificationError("Import commit contains no changed paths.")
        source_paths = set(git.changed_paths(source_parents[0], source))
        extra_paths = sorted(set(selected_paths) - source_paths)
        if extra_paths:
          raise VerificationError(f"Import changes paths absent from its upstream source: {json.dumps(extra_paths, ensure_ascii=True)}")
        adaptations = [
          (commit, path) for path in selected_paths
          if git.file_delta(parents[0], commit, path) != git.file_delta(source_parents[0], source, path)
        ]
        # Rebuild only restricted paths from the merge base. Do not exempt a
        # whole file: local edits before/after an import must remain detectable.
        # Apply the actual imported deltas, including fork adaptations,
        # rather than reapplying the upstream patch against divergent files.
        # Allowed fork/UI edits cannot conflict with this independent baseline.
        # Paths already identical to the accepted base need no exemption. This
        # also avoids replaying additions that a later base merge already has.
        selected_restricted = [path for path in selected_paths if path in restricted_paths]
        expected = replay.apply(expected, git.patch(
          parents[0], commit, paths=selected_restricted,
        ))
        result.imports.append((commit, source))
        result.adaptations.extend(adaptations)
      except VerificationError as error:
        result.errors.append(f"{commit[:12]} -> {source[:12]}: {error}")
    result.violations = sorted(path for path in replay.changed_paths(expected, head) if not is_allowed(path))
  return result


def display(value: str) -> str:
  return f"<code>{html.escape(json.dumps(value, ensure_ascii=True))}</code>"


def report(result: Result) -> str:
  lines = ["## Fork change scope", "", (
    f"Verified upstream sources/file scopes: **{len(result.imports)}** · Fork commits: **{result.fork_commits}**"
  ), ""]
  lines.append("**Failed:** unverified imports or fork changes outside the allowlist." if result.failed else (
    "**Passed:** upstream provenance/file scopes are verified; remaining fork changes are within the allowlist."
  ))
  if result.imports:
    lines.extend(["", "### Upstream-linked imports", ""])
    lines.extend(
      f"- `{commit[:12]}` ← [{source[:12]}]({UPSTREAM_URL}/commit/{source})"
      for commit, source in result.imports[:100]
    )
    if len(result.imports) > 100:
      lines.append(f"- {len(result.imports) - 100} additional imports verified.")
  if result.adaptations:
    lines.extend(["", "### Adapted imported files — review, not failure", ""])
    lines.extend(f"- `{commit[:12]}`: {display(path)}" for commit, path in result.adaptations[:100])
    if len(result.adaptations) > 100:
      lines.append(f"- {len(result.adaptations) - 100} additional adapted files; see the job log.")
    lines.extend(["", "Source ancestry and file scope are verified; adapted content is not certified as an exact upstream copy."])
  if result.errors:
    lines.extend(["", "### Import verification errors", ""])
    lines.extend(f"- {display(error[:1000])}" for error in result.errors[:30])
  if result.violations:
    folders = sorted({str(PurePosixPath(path).parent) + "/" if "/" in path else "(repository root)" for path in result.violations})
    lines.extend(["", "### Affected folders", ""])
    lines.extend(f"- {display(folder)}" for folder in folders[:50])
    lines.extend(["", "### Fork-only files outside the allowlist", ""])
    lines.extend(f"- {display(path)}" for path in result.violations[:100])
    if len(result.violations) > 100:
      lines.append(f"- {len(result.violations) - 100} additional files; see the job log.")
  lines.extend(["", "### Allowed fork folders", ""])
  lines.extend(f"- `{prefix}`" for prefix in ALLOWED_PREFIXES)
  lines.extend(["", "### Allowed CI maintenance files", ""])
  lines.extend(f"- `{path}`" for path in ALLOWED_FILES)
  lines.extend(["", (
    "Import merged upstream commits with `git cherry-pick -x` (merge commits: `-x -m 1`). "
    "Whole commits, file subsets, and adapted imports are supported; keep one source marker per commit. "
    "Titles/labels do not grant exemptions. "
    "Allowed fork paths need no upstream match; unknown source SHAs or unrelated restricted paths fail closed. "
    "Adaptations require human review."
  )])
  # GitHub limits comment bodies. Truncate between lines so escaped data never
  # becomes broken HTML; the job log still contains all errors and paths.
  bounded: list[str] = []
  length = 0
  for line in lines:
    if length + len(line) + 1 > 60000:
      bounded.append("\nReport truncated; see the job log for full errors and paths.")
      break
    bounded.append(line)
    length += len(line) + 1
  return "\n".join(bounded) + "\n"


def main() -> int:
  try:
    result = check_scope(Path.cwd(), os.environ["PR_BASE_SHA"], os.environ["PR_HEAD_SHA"])
  except (VerificationError, subprocess.TimeoutExpired, KeyError, OSError) as error:
    result = Result(errors=[str(error)])
  for error in result.errors:
    print(f"Import verification error: {json.dumps(error, ensure_ascii=True)}")
  for path in result.violations:
    print(f"Fork-only file outside allowlist: {json.dumps(path, ensure_ascii=True)}")
  for commit, path in result.adaptations:
    print(f"Adapted imported file for review: {commit[:12]} {json.dumps(path, ensure_ascii=True)}")
  message = report(result)
  print(
    f"Verified {len(result.imports)} upstream sources/file scopes; {len(result.adaptations)} adapted files; "
    f"{len(result.violations)} scope violations; {len(result.errors)} verification errors."
  )
  if result.failed:
    print("::error::Fork scope check failed. See import verification errors and restricted paths in the job summary.")
  if os.environ.get("GITHUB_STEP_SUMMARY"):
    with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as summary:
      summary.write(message)
  if os.environ.get("RUNNER_TEMP"):
    (Path(os.environ["RUNNER_TEMP"]) / "fork-scope-report.md").write_text(message, encoding="utf-8")
  if os.environ.get("GITHUB_OUTPUT"):
    with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as outputs:
      outputs.write(f"violations_found={str(result.failed).lower()}\n")
  return int(result.failed)


if __name__ == "__main__":
  raise SystemExit(main())
