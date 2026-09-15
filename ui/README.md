# CAIPE UI

Next.js BFF and web UI for CAIPE. The UI talks to Dynamic Agents through
server-side API routes, manages MongoDB-backed chat state, and exposes admin
surfaces for models, MCP servers, skills, credentials, RBAC, audit logs, and
platform health.

## Quick Start

From the repository root:

```bash
make caipe-ui-dev
```

Or run directly:

```bash
cd ui
npm install
npm run dev
```

Open http://localhost:3000.

## Tome ingest review

The review screen lists every file an ingest created or modified. Files held
by the entity's review policy are reviewed one at a time; files that the
policy already published remain visible and are labeled **Published**.

- **Accept file** publishes that file when the review is finalized.
- **Reject file** keeps the prior live file and retains the rejected revision
  in history.
- **Accept all** / **Reject all** resolves every draft and finishes the ingest
  review in one click, replacing any individual file choices. No separate
  **Finish review** click is needed. Accept all still enforces the quality gate;
  Reject all never publishes files. Already-published files are unchanged.
- **Finish review** becomes available after every required file has a decision,
  then applies the complete review and unlocks the Tome project. The screen
  always displays the reason while this action is unavailable.

The default **Stable pages only** policy holds stable files for decisions and
publishes dynamic files immediately. Choose **Review everything** under
Project settings → Review to require an Accept/Reject decision for every file
on future ingests.

Individual decisions are persisted as they are made, but do not change live pages
before **Finish review** (or an explicit **Accept all** / **Reject all** action).
Starting a file-level review disables that run's unattended draft
auto-promotion so an explicit rejection cannot later be published by timeout.
Runs with no file-level decisions retain the existing auto-promotion behavior.

## Runtime Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DYNAMIC_AGENTS_URL` | `http://localhost:8100` in local dev, `http://dynamic-agents:8100` in production | Server-side Dynamic Agents runtime URL |
| `MONGODB_URI` | unset | Enables MongoDB-backed conversations and admin state |
| `PROMETHEUS_URL` | unset | Server-side Prometheus-compatible query URL for Admin metrics and health. In HA deployments, use a deduplicating query frontend such as Thanos rather than a load-balanced service over independent Prometheus replicas. |
| `RAG_SERVER_URL` | unset | Server-side RAG API URL |
| `NEXTAUTH_SECRET` | unset | Required for authenticated deployments |
| `SSO_ENABLED` | `false` | Enables OIDC-backed auth |
| `AGENTIC_APPS_INSTALL_ENABLED` | `false` | Enables Agentic Apps user, admin, and proxy routes when set to `true` |
| `AGENTIC_APPS_CONFIG_PATH` | unset | Optional path to a dedicated YAML file containing deploy-managed Agentic App packages and installations |
| `AGENTIC_APPS_CAS_MODE` | `enforce` | CAS mode: `enforce`, `shadow`, or `off`. Enforce fails closed; built-in `agentic_app:<id>#user` grants are reconciled at startup. |
| `TOME_MANAGED_WEBEX_MESSAGING_ENABLED` | `false` | Exposes managed Webex space ingest when the configured account has a healthy, identity-verified connection. |

Browser chat traffic goes through the BFF routes under
`/api/v1/chat/stream/*`; the browser does not call the Dynamic Agents service
directly.

### Managed Webex space ingest

Tome projects can use either a user's Webex connection or one deployment-owned,
messaging-only account. Configure a separate `webex_messaging` OAuth connector
with only `spark:kms`, `spark:rooms_read`, `spark:messages_read`,
`spark:people_read`, and `spark:memberships_read`, then set:

```text
TOME_MANAGED_WEBEX_MESSAGING_ENABLED=true
TOME_MANAGED_WEBEX_MESSAGING_PROVIDER=webex_messaging
TOME_MANAGED_WEBEX_MESSAGING_ACCOUNT_EMAIL=<exact account email>
```

The account must log into CAIPE and connect that provider itself. CAIPE resolves
the account's current OIDC subject from its user record, finds that subject's
connection, and verifies that Webex `/people/me` returns the configured email.
The project option appears only after those checks pass.
The managed picker tells users which account to add to a Webex space and lists
only rooms where the signed-in user and managed account are both current Webex
members. Project authorization continues to govern who can access the ingested
content. Saving and ingesting recheck shared Webex membership; removing either
account from a room therefore fails closed.
Managed tokens remain server-side, are used only for ingest, and are never sent
to Tome chat, AgentGateway, meeting tools, or the browser. Projects created
before this feature remain on their existing personal Webex path.

### MyAgent delegated ingestion

Tome can optionally ask MyAgent for selected Outlook, Salesforce, or
SharePoint context while it ingests a project. Configure the feature with a
MyAgent Webex recipient identity:

```text
TOME_MYAGENT_ENABLED=true
TOME_MYAGENT_WEBEX_EMAIL=<MyAgent Webex email>
TOME_MYAGENT_POLL_INTERVAL_MS=2000
TOME_MYAGENT_REPLY_TIMEOUT_MS=30000
```

Each browser user explicitly authorizes TOME to send a delegated request for
their own identity; that authorization is not project-wide. For every run,
CAIPE resolves the triggering user's own `webex` connection, sends a bounded
one-time direct message naming the requested connector categories to MyAgent
as that user, and accepts only a reply correlated to that request. It never
uses the managed Webex identity for this path and never exposes the user Webex
token to the Tome agent. The selected categories limit TOME's request; they
are not a CAIPE-enforced provider scope. MyAgent—not CAIPE—enforces the
Outlook, Salesforce, and SharePoint authorizations, and CAIPE cannot verify
which connector produced a reply. Users must manage the actual integrations in
[MyAgent connector settings](https://circuit.cisco.com/myagent/settings/connectors).
Hard per-connector provenance requires a MyAgent-owned scoped delegation API
or attestation contract, which this Webex handoff does not currently expose.
Existing Webex connections must be reauthorized to grant both message read and
message write permissions. A received reply is retained as protected evidence
and is used only in a restricted wiki-only follow-up pass. Every report it
influences is a private draft with no deadline auto-promotion; only the
authorizing user or a Tome administrator can explicitly approve it. After that
approval, its pages follow the project's normal sharing rules. The raw
delegated run trace and detailed quality evidence remain restricted to the
authorizing user and Tome administrators. Disconnect blocks requests that have
not yet been claimed; a Webex message already sent cannot be recalled, but its
reply is discarded if the revoke wins before consumption.
MyAgent delegation is manual-only: scheduled auto-ingest never sends a request
using a user's MyAgent/Webex authorization.

### Config-driven Agentic Apps

Set `AGENTIC_APPS_CONFIG_PATH` when Agentic Apps should be registered from a
small config file independently of the main `APP_CONFIG_PATH` file. The file is
validated before any records are changed. Config-managed records are read-only
through the admin APIs, are reapplied at startup, and are removed when omitted
from the declared package or installation lists.

```yaml
agentic_apps:
  packages:
    - package_id: example-app
      source: helm
      manifest:
        id: example-app
        displayName: Example App
        description: Example externally hosted app.
        apiVersion: "1.0"
        runtime:
          kind: proxied-next-zone
          mountPath: /apps/example-app
          origin: ${EXAMPLE_APP_ORIGIN}
          chrome: iframe
        ui:
          contractVersion: "1.0"
          surface: hosted
          routes: ["/"]
        authorization:
          resourceType: agentic_app
          launchAction: use
        surfaces:
          showInHub: true
          showInTopNav: true
        access:
          requiredRoles: [user]
          tokenScopes: [example-app:read]
        health:
          endpoint: /healthz
  installations:
    - app_id: example-app
      package_id: example-app
      installed: true
      enabled: true
      visible: true
      runtime_mount_path: /apps/example-app
      runtime_origin_override: ${EXAMPLE_APP_ORIGIN}
      access_overrides:
        requiredRoles: [user]
      health_policy:
        block_launch_when: [degraded, unreachable]
```

Each package needs either an inline `manifest` or a JSON `manifest_path`
relative to this YAML file. The current proxy binds routes by app ID, so an
installation mount must be `/apps/<app_id>`. Environment placeholders use the
same `${VAR}` and `${VAR:-default}` expansion supported by the main seed config.

## Development Commands

```bash
npm run lint
npm test
npm run build
```

For Docker Compose:

```bash
COMPOSE_PROFILES=caipe-ui,dynamic-agents,caipe-mongodb docker compose -f ../docker-compose.dev.yaml up --build
```

## App Structure

```text
ui/src/app/                 Next.js App Router pages and API routes
ui/src/components/          React components
ui/src/components/chat/     Chat UI and Dynamic Agents timeline
ui/src/components/dynamic-agents/
                            Agent, model, MCP server, and workflow management
ui/src/components/admin/    Admin and RBAC surfaces
ui/src/lib/                 BFF utilities, clients, auth, RBAC helpers
ui/src/store/               Zustand stores
ui/src/types/               Shared TypeScript types
```

## Current Chat Flow

1. The user selects or opens a conversation in the UI.
2. The BFF validates auth/RBAC and forwards stream requests to Dynamic Agents.
3. Dynamic Agents streams AG-UI/SSE events back through the BFF.
4. The UI stores conversation messages and stream events in MongoDB-backed state.
5. MCP tools are reached through configured MCP server rows, usually via AgentGateway.

## Related Docs

- [UI overview](../docs/docs/ui/index.md)
- [UI configuration](../docs/docs/ui/configuration.md)
- [Tome Webex manual and recurring meeting ingest](src/lib/tome/auto-ingest/README.md)
- [Dynamic Agents API](../docs/docs/api/dynamic-agents-mcp.md)
- [Helm chart reference](../docs/docs/installation/helm-charts/ai-platform-engineering/caipe-ui.md)

## Tome analytics and ingestion budget

The Projects admin analytics page has three sections:

- **Usage:** distinct authenticated chat session owners who sent user prompts in
  trailing 24-hour, 7-day, and 30-day windows. An active Project, Area, or BHAG
  received a prompt directly; child activity and scheduled ingestion do not count.
  Catalog denominators include all non-archived entities, including drafts.
  **Reading and discovery:** successfully rendered Tome navigations, wiki page
  views, unique readers, Agent opens, and top pages. Background polling does not
  count. Views start when this instrumentation is deployed; coverage is shown.
  Returning viewers visited on at least two UTC dates in the selected 30-day
  window. Browser sessions use a per-tab session-storage identifier.
- **Content:** freshness, technical ingestion failures, review outcomes, current
  template bindings, revision sources, and feedback/service diagnostics. Missing
  legacy template metadata falls back to frontmatter; explicit null stays unbound.
  Historical manual edits are recovered only where revision metadata supports it.
- **Budget:** an optional organization-wide monthly USD limit, stored in MongoDB
  `tome_budget_config`. Only Tome admins can change it; changes are audited.
  The limit and warning threshold provide dashboard monitoring, not enforcement
  or external notifications. No limit is configured by default.

Budget spend includes reported non-negative `cost_usd` from source ingestion and
Area/BHAG synthesis, attributed to the UTC calendar month of `started_at`.
Archived/removed entities and failed runs with reported cost remain included.
Runs without reported cost are counted separately; remaining budget can be
overstated until those costs arrive. In-flight costs may increase. This is an
operational estimate, not a provider invoice; chat and separate evaluation costs
are excluded. No historical data migration is required.
