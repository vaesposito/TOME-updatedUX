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
| `check-fork-scope.yml` | Every PR and new commit | Verifies upstream imports; restricts remaining fork changes to allowed folders |
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
require verified upstream imports.

#### Importing upstream changes

- Fetch [official upstream](https://github.com/caipe-io/ai-platform-engineering)
  and import its merged commits with `git cherry-pick -x <full-SHA>`.
- Multiple upstream PRs/commits can be imported in one fork PR. Keep one
  source marker per import commit; do not squash them together.
- For an upstream merge commit, use `git cherry-pick -x -m 1 <full-SHA>`.
  Only first-parent/mainline 1 is supported. Squash-merged upstream PRs are
  ordinary single-parent commits; rebased PRs may require multiple commits.
- PR titles and labels do not grant exemptions. A source marker identifies
  a claim, not proof.

For every marked commit, CI verifies that the source SHA belongs to official
upstream `main`. It independently applies that source change to the fork
commit's parent in an isolated index and requires the entire resulting tree
to match the import commit, including file modes and binary content.
Existing private UI changes are preserved; CI does not compare whole files
against upstream or trust patch IDs.

CI then rebuilds the restricted-path baseline from the PR merge base using
only verified upstream changes. Remaining fork changes must satisfy the
allowlist. Editing a restricted file before or after importing an upstream
change to it does not exempt the extra edits. Additions, deletions, and both
paths of renames are checked. Existing fork differences and commits already
in the PR target branch are not re-audited.

Malformed/multiple source markers, unknown or unmerged SHAs, missing history,
extra edits in import commits, and replay conflicts fail closed. Manually
adapted imports do not qualify as clean imports, even when their files are
inside the normal allowlist. Keep allowed fork adaptations in separate,
unmarked commits. Restricted-path adaptations require upstreaming or an
explicitly reviewed policy change; there is no label-based bypass.

The job log and summary show verified source SHAs, import verification errors,
and remaining restricted files. Failures also receive a PR comment.

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
