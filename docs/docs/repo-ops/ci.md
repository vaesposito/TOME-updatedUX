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
| `check-fork-scope.yml` | Every PR and new commit | Rejects changes outside this fork's allowed folders |
| `coverage-comment.yml` | PR | Posts test coverage delta as a PR comment |

### Fork change scope

The **Fork change scope** check runs when a PR is opened, updated with new
commits, reopened, or edited (including changing its target branch). It applies
to all target branches, including draft PRs. Only these folders are allowed:

- `ui/`
- `ai_platform_engineering/agents/tome/`
- `docs/`

The check compares the PR head with its merge base against the target branch.
It checks the full PR, including additions, modifications, deletions, and both
paths of renames. Existing differences between this fork and upstream are not
audited. Upstream sync PRs are subject to the same folder restrictions.

Failures list the affected folders and files in the job log and summary:

> File changes in the folders below detected. Please upstream these changes
> first and remove them from this PR.

Submit those changes to [upstream](https://github.com/caipe-io/ai-platform-engineering)
and remove them from the fork PR. Root files and `.github/` are outside the
allowlist, including this workflow itself. Its initial addition therefore fails
the check and needs a maintainer to land it before enabling it as required.

To block merges, make **Fork change scope** a required status check in the
repository's branch protection or ruleset. This workflow reports failures; it
does not configure repository rules. Like other `pull_request` workflows, it
waits for merge conflicts to be resolved before GitHub runs it.

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
