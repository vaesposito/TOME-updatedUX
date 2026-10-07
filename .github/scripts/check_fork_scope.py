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

  def patch(self, parent: str, commit: str, *, paths: list[str] | None = None) -> bytes:
    if paths == []:
      return b""
    return self.run(
      "diff", "--binary", "--full-index", "--no-renames" if paths is not None else "--find-renames",
      "--no-ext-diff", "--no-textconv", parent, commit, "--",
      *(f":(top,literal){path}" for path in paths or ()),
    ).stdout

  def apply(self, tree: str, patch: bytes) -> str:
    self.run("read-tree", tree)
    if patch:
      result = self.run("apply", "--cached", "--3way", "--whitespace=nowarn", data=patch, check=False)
      if result.returncode:
        raise VerificationError("Upstream changes do not replay cleanly; conflict resolutions/adaptations are not exempt.")
    return self.text("write-tree")


@dataclass
class Result:
  imports: list[tuple[str, str]] = field(default_factory=list)
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
  changed = git.run("diff", "--name-only", "--no-renames", "-z", merge_base, head, "--").stdout
  restricted_paths = [
    os.fsdecode(path) for path in changed.split(b"\0") if path and not is_allowed(os.fsdecode(path))
  ]
  commits = git.text("rev-list", "--reverse", "--topo-order", head, f"^{base}").splitlines()
  claims: list[tuple[str, str]] = []
  for commit in commits:
    try:
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
        imported = replay.apply(parents[0], git.patch(source_parents[0], source))
        if imported != git.text("rev-parse", f"{commit}^{{tree}}"):
          raise VerificationError("Commit tree differs from replayed upstream changes; extra edits are not a clean import.")
        # Rebuild only restricted paths from the merge base. Do not exempt a
        # whole file: local edits before/after an import must remain detectable.
        # Allowed fork/UI edits cannot conflict with this independent baseline.
        # Paths already identical to the accepted base need no exemption. This
        # also avoids replaying additions that a later base merge already has.
        expected = replay.apply(expected, git.patch(source_parents[0], source, paths=restricted_paths))
        result.imports.append((commit, source))
      except VerificationError as error:
        result.errors.append(f"{commit[:12]} -> {source[:12]}: {error}")
    changed = replay.run("diff", "--name-only", "--no-renames", "-z", expected, head, "--").stdout
    result.violations = sorted(
      os.fsdecode(path) for path in changed.split(b"\0") if path and not is_allowed(os.fsdecode(path))
    )
  return result


def display(value: str) -> str:
  return f"<code>{html.escape(json.dumps(value, ensure_ascii=True))}</code>"


def report(result: Result) -> str:
  lines = ["## Fork change scope", "", (
    f"Verified upstream imports: **{len(result.imports)}** · Fork commits: **{result.fork_commits}**"
  ), ""]
  lines.append("**Failed:** unverified imports or fork changes outside the allowlist." if result.failed else (
    "**Passed:** upstream imports are verified; remaining fork changes are within the allowlist."
  ))
  if result.imports:
    lines.extend(["", "### Verified upstream imports", ""])
    lines.extend(
      f"- `{commit[:12]}` ← [{source[:12]}]({UPSTREAM_URL}/commit/{source})"
      for commit, source in result.imports[:100]
    )
    if len(result.imports) > 100:
      lines.append(f"- {len(result.imports) - 100} additional imports verified.")
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
    "Keep one source marker per commit. Titles/labels do not grant exemptions. "
    "Adapted imports and unverifiable history fail closed."
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
  message = report(result)
  print(f"Verified {len(result.imports)} upstream imports; {len(result.violations)} scope violations; {len(result.errors)} verification errors.")
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
