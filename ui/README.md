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
members. Project authorization governs who can access the ingested content.

In **Settings → Sources → Webex**:

- One **Webex source** card with the Webex logo contains **Selected Webex Spaces**
  first, then **Add a new Webex Space**, separated by a divider.
- **Selected Webex Spaces** shows every attached space and its **Runs as**
  identity, independently of the discovery tabs.
- **Add a new Webex Space** supports personal and managed discovery; both
  lists exclude all room IDs already attached to this project. Switching tabs
  clears stale results and refreshes without changing saved selections.
- Adding a personal space requires access using the current user's selected
  connection. Adding a managed space requires both that user and the generic
  account to belong to the space.
- New attachments record server-verified `added_by` (subject, name, email,
  timestamp) and per-room `credential_mode`/`credential_provider`. The adder
  is attribution only, **never** the account used for personal ingestion.
- An editor can remove a space only if they currently have Webex access to it.
  Managed removal checks shared membership. Both the UI and save API enforce
  this; retaining another user's inaccessible space does not require access.
- Adder attribution is hidden for accessible spaces. Inaccessible spaces show
  “User X added it and you don't have access to delete.” Lookup failures leave
  removal disabled without claiming that membership was revoked.
- The existing **Refresh** button also rechecks selected-space removal access.
- Older records retain their project-level account settings and unknown
  adders. There is no migration, ownership inference, or reassignment step.
  Changing a retained legacy space's account type requires explicitly
  removing and re-adding it.

**Execution rules (manual and scheduled):**

- Personal manual ingestion uses the person starting it; scheduled ingestion
  uses `autoIngest.credentialOwner`. An inaccessible personal room still
  reports an access error and never borrows the adder's credentials.
- Managed ingestion uses the configured generic account. The initiating user
  or schedule owner does **not** need Webex membership or a Webex connection;
  project ingestion authorization and the generic account's access are what
  matter. Loss of generic-account access fails clearly.
- Projects can mix personal and managed spaces. **Runs as** reflects each
  resolved account; profile lookup failure falls back to the connection type,
  not an invented user name.
- **Run ingest** groups Webex spaces into **Will be ingested** and **Won't be
  ingested**, with per-space connection/access reasons. Personal access issues
  do not prevent accessible managed spaces from contributing data. Failed
  checks are labeled **Access not verified**, not missing membership. A managed
  account failure is shown as **Ingest blocked**, matching execution policy.
- Scoped room tokens remain server-side and are forwarded only for ingestion.
  Generic tokens cannot read unrelated rooms, arbitrary people/messages,
  meetings, or transcripts, and are never forwarded to chat or the browser.
  Existing meeting-ingest authentication is unchanged.

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
