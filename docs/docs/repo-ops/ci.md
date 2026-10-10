---
id: ci
title: CI Workflows
sidebar_label: CI Workflows
sidebar_position: 2
description: Reference for every GitHub Actions workflow in ai-platform-engineering — triggers, purpose, and manual dispatch instructions.
---

# CI Workflows

All workflows live in `.github/workflows/`. The table below is the quick reference; click a workflow name to view the file on GitHub.

## Build & Test

| Workflow | Trigger | What it does |
|---|---|---|
| `ci-rag.yml` | PR / push to `main` | Tests the RAG ingestor and query pipeline |
| `ci-mcp-sub-agent.yml` | PR / push to `main` | Tests packaged MCP servers |
| `ci-dynamic-agents.yml` | PR / push to `main` | Tests the dynamic-agents Helm chart and operator |
| `ci-caipe-ui.yml` | PR / coordinated Tome dispatch | Validates the UI image on PRs and publishes the coordinated multi-arch release image |
| `caipe-ui-tests.yml` | PR / push to `main` | Jest unit tests and mocked RBAC Playwright regression for the UI |
| `ci-helm.yml` | PR / push to `main` | Helm chart lint and template validation |
| `helm-chart-test.yml` | PR / push to `main` | Full Helm chart install test on a Kind cluster |
| `ci-skill-scanner.yml` | PR / push to `main` | Security scan of `.claude/skills/` content |
| `ci-slack-bot.yml` | PR / push to `main` | Tests the Slack Bot integration |
| `ci-webex-bot.yml` | PR / push to `main` | Tests the Webex Bot integration |
| `ci-agentgateway-config-bridge.yml` | PR / push to `main` | Tests the AgentGateway config bridge |
| `ci-audit-service.yml` | PR / push to `main` | Tests the audit service |
| `ci-openfga-authz-bridge.yml` | PR / push to `main` | Tests the OpenFGA authz bridge |
| `ci-keycloak-init.yml` | PR / push to `main` | Tests Keycloak bootstrap tooling |

## Quality Gates

| Workflow | Trigger | What it does |
|---|---|---|
| `conventional_commits.yml` | PR | Enforces Conventional Commits on PR title |
| `check-pinned-deps.yml` | PR / push | Verifies all action dependencies are pinned to a SHA |
| `check-proprietary-content.yml` | PR | Scans for proprietary or sensitive content |
| `check-fork-scope.yml` | Every PR and new commit | Verifies upstream provenance/file scope; reports adaptations; restricts remaining fork changes |
| `coverage-comment.yml` | PR | Posts test coverage delta as a PR comment |

### Fork change scope

The **Fork change scope** check runs when a PR is opened, updated with new
commits, reopened, or edited (including changing its target branch). It applies
to all target branches, including draft PRs. Fork-only changes are allowed in:

- `ui/`
- `ai_platform_engineering/agents/tome/`
- `docs/`

Exact CI maintenance exceptions are the workflow itself and
`.github/scripts/check_fork_scope.py`. Other `.github/` files and root files
require imports linked to merged upstream commits.

#### Importing upstream changes

- Fetch [official upstream](https://github.com/caipe-io/ai-platform-engineering)
  and import its merged commits with `git cherry-pick -x <full-SHA>`.
- Multiple upstream PRs/commits can be imported in one fork PR. Keep one
  source marker per import commit; do not squash them together.
- Whole commits or file/folder subsets are supported. For a subset, use
  `git cherry-pick -x --no-commit <full-SHA>`, keep only the intended upstream
  files, and commit with the original message and its full-SHA `-x` marker.
  Omitted upstream files need not apply cleanly. Selected files may be adapted
  for the fork, including resolving conflicts or matching local chart versions.
  CI lists those adaptations for human review rather than rejecting them.
- For an upstream merge commit, use `git cherry-pick -x -m 1 <full-SHA>`.
  Only first-parent/mainline 1 is supported. Squash-merged upstream PRs are
  ordinary single-parent commits; rebased PRs may require multiple commits.
- PR titles and labels do not grant exemptions. A source marker identifies
  a claim, not proof.

Allowed fork paths bypass import verification: `ui/`, TOME, `docs/`, and exact
maintenance exceptions may be changed or omitted from an upstream import.
Mixed commits may combine those fork changes with restricted upstream files;
only their restricted files need upstream provenance. Allowed-only commits
need no upstream source, even when they retain an import marker.

For every marked commit that changes restricted files, CI verifies that the
source SHA belongs to official upstream `main`. It infers the restricted file
subset from the import commit's actual diff and checks that each of those files
changed in that upstream source. It does not replay the upstream commit or
reject conflict resolutions. It compares
per-file changed content/modes, ignoring unchanged context and hunk positions,
and reports differing deltas as **adapted imported files**. Binary deltas may
also differ because of existing fork content. These notes do not fail CI.
No title, label, or folder name is trusted as an exemption.

This is a provenance/file-scope check, **not proof that adapted content is
identical to upstream**. An import marker does not make adaptations safe:
review their diffs before merging. Restricted paths absent from the marked
source commit still fail. Allowed fork paths are never required to match
upstream and do not invalidate the restricted imported portion.

CI then rebuilds the restricted-path baseline from the PR merge base using
only the actual imported deltas, including adaptations. Remaining fork changes
must satisfy the allowlist. Importing a restricted file does not exempt that
whole file from checking unmarked changes. Additions, deletions, and both
paths of renames are checked. Existing fork differences and commits already
in the PR target branch are not re-audited.

Malformed/multiple source markers, unknown or unmerged SHAs, missing history,
paths absent from the source commit, and failures to isolate the imported
deltas from unrelated fork edits fail closed. Adaptations to imported paths
are permitted and explicitly reported. There is no label-based bypass.

The job log and summary show verified source SHAs/file scopes, adapted files,
import verification errors, and remaining restricted files. Failures also
receive a PR comment.

#### Trust boundary and rollout

The workflow uses `pull_request_target` and checks out the PR's trusted base
SHA. It fetches PR objects without checking out, importing, or executing any
PR files. The public upstream URL and accepted branch are fixed by the trusted
workflow. Credentials for fetching the private PR history are scoped to that
fetch and never sent to upstream.

Changes to this checker cannot weaken their own check: proposed policy changes
are data, while verification uses the already-landed base version. The workflow
and scripts must land in the default/target branches before the new policy is
active. Initial rollout may require a maintainer to land the CI maintenance
files under the old policy. Later policy updates take effect only after merge.

To block merges, make **Fork change scope** a required status check in the
repository's branch protection or ruleset. This workflow reports failures; it
does not configure repository rules. Unlike `pull_request` workflows, this
trusted-base check can run even when the PR has merge conflicts. It does not
resolve those conflicts or change branches.

## Release

| Workflow | Trigger | What it does |
|---|---|---|
| `auto-tag.yml` | Push to `main` / `release/*` | Computes and pushes the next semver tag (`x.y.z-dev.N`, `x.y.z-rc.N`) |
| `release-finalize.yml` | Manual dispatch | Promotes an RC tag to a final `x.y.z` release; publishes Helm chart to GHCR |
| `release-manual.yml` | Manual dispatch | Emergency manual release path (hotfixes) |
| `docs-release.yml` | Semver tag push | Generates release blog post via Claude Code CLI, opens docs PR |
| `publish-gh-pages.yml` | Push to `main` | Builds Docusaurus and deploys to GitHub Pages |
| `docs-build-check.yml` | PR touching `docs/` | Verifies `npm run build` passes before merge |

## Tagging convention

See [CI/CD & Releases](../development/ci-cd-and-releases) for the full branch flow and tag shape reference.

## Running a workflow manually

Any workflow with `workflow_dispatch:` can be triggered from the GitHub UI:

1. Go to **Actions** → select the workflow
2. Click **Run workflow** → choose the branch → fill in inputs → **Run**

Or via CLI:

```bash
gh workflow run release-finalize.yml \
  --repo caipe-io/ai-platform-engineering \
  -f version=0.4.9
```
