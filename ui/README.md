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

## Tome Assistant

- **Ask Tome** opens a floating assistant in the bottom-right corner of a
  project's wiki, ingest, settings, and report views.
- The panel uses the same project chat as the Agent view, including connected
  credentials, server history, streaming, Stop, Clear, and compact controls.
- On wiki pages, **Ask about this page** fills the composer with a source-aware
  question. The user sends it explicitly.
- Minimize the panel to keep browsing, expand it for more room, or press Escape
  to close it and return focus to the launcher. Minimizing preserves the draft
  and continues an active response.
- Page links open in the project view; agent page writes refresh its wiki.
- The Agent view keeps its existing full-size chat and does not show a second
  floating chat. The assistant is mounted inside the wiki's fullscreen surface.

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
- Managed discovery says **No new shared spaces found** when returned spaces
  are already attached; **No shared spaces found** means none were returned.
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

- `TOME_WEBEX_SPACE_PROVIDER` chooses the personal **space** connector (default
  `webex`; set to `webex_messaging` to use Webex Messaging). New-space discovery
  and additions require this connector; prompts show its configured app name.
- Ingestion and access checks for existing personal spaces prefer the caller's
  connected configured provider, falling back to `webex` when it is not connected.
  Scheduled runs use the schedule owner's connections with the same rule.
  Refresh failures or denied room access do not trigger an identity fallback.
  No existing source metadata is migrated. This setting is independent of
  `TOME_MANUAL_WEBEX_PROVIDER`, which controls recorded meetings only.
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

### MyAgent delegated ingestion

Tome can optionally ask MyAgent for selected Outlook, Salesforce, or
SharePoint context while it ingests a project. Configure the feature with a
MyAgent Webex recipient identity:

```text
TOME_MYAGENT_ENABLED=true
TOME_MYAGENT_WEBEX_EMAIL=<MyAgent Webex email>
TOME_MYAGENT_POLL_INTERVAL_MS=2000
TOME_MYAGENT_REPLY_TIMEOUT_MS=30000
WEBEX_MYAGENT_CLIENT_ID=<dedicated Webex OAuth app client ID>
WEBEX_MYAGENT_CLIENT_SECRET=<dedicated Webex OAuth app client secret>
# Use this deployment's public origin and register the same URI on the app.
WEBEX_MYAGENT_REDIRECT_URI=https://app.example.com/api/credentials/oauth/webex_myagent/callback
```

`TOME_MYAGENT_ENABLED` gates MyAgent in TOME chat and project source settings.
When unset or false, MyAgent source controls and per-ingest selectors are
hidden, the chat checkbox is hidden, and chat requests use ordinary project chat.

Use an existing dedicated app or register one with only these scopes: `spark:kms`,
`spark:messages_read`, and `spark:messages_write`. It appears in Connections as
**MyAgent (Webex)**, independently of the general Webex connector. Keep the
general app's credentials and room/people/meeting scopes separate. No people
profile scope is requested for the MyAgent app, so it has no Webex profile lookup.
Set its redirect URI to a callback already registered on that app. The shared
`/api/credentials/oauth/webex/callback` is supported: the callback resolves the
dedicated provider from signed OAuth state, so it does not overwrite the general
`webex` connection. A provider-specific callback can also be used if registered.

Each browser user explicitly authorizes TOME to send a delegated request for
their own identity; that authorization is not project-wide. For every run,
the agent reads the project wiki and the user's ingest focus, then uses
`ask_myagent(question)` to fill specific gaps. There is no generic upfront
"evidence summary" request. The tool supports up to three sequential questions
per manual ingest or chat turn, including a targeted follow-up. The optional
seed instruction is sent to MyAgent as the original research request, alongside
the agent's more specific question. For example: "Who owns the
launch blocker discussed in this week's project emails, and what is the agreed
next step?"

CAIPE resolves the triggering user's own `webex_myagent` connection for each
question, adds the project title/context and selected source names, and accepts
only a reply correlated to that question's Webex thread. It never
uses the managed Webex identity for this path and never exposes the user Webex
token to the Tome agent. The selected categories limit TOME's request; they
are not a CAIPE-enforced provider scope. MyAgent—not CAIPE—enforces the
Outlook, Salesforce, and SharePoint authorizations, and CAIPE cannot verify
which connector produced a reply. Users must manage the actual integrations in
[MyAgent connector settings](https://circuit.cisco.com/myagent/settings/connectors).
Hard per-connector provenance requires a MyAgent-owned scoped delegation API
or attestation contract, which this Webex handoff does not currently expose.
Users must explicitly connect **MyAgent (Webex)**; existing `webex` connections
are not reused, migrated, or used as a fallback. A received reply is retained as protected evidence
and is used only in a restricted project-research pass. That pass has same-project
wiki tools and the run-scoped MyAgent tool, but no general web, source MCP,
cross-project or shell tools. Every report it
influences is a private draft with no deadline auto-promotion; only the
authorizing user or a Tome administrator can explicitly approve it. After that
approval, its pages follow the project's normal sharing rules. The raw
delegated run trace and detailed quality evidence remain restricted to the
authorizing user and Tome administrators. Disconnect blocks requests that have
not yet been claimed; a Webex message already sent cannot be recalled, but its
reply is discarded if the revoke wins before consumption.
MyAgent is also available in TOME chat. An explicit request such as "ask MyAgent
for my emails" selects MyAgent research automatically; the **Ask MyAgent**
composer checkbox keeps follow-up questions in that mode and can be turned off
to return to ordinary project chat. Research chat is private and read-only, with
no project edits or general source tools. Its SDK session is never resumed with
ordinary chat's tools. Scheduled auto-ingest never uses MyAgent authorization.

Choose Outlook, SharePoint and/or Salesforce in project MyAgent settings.
Ingestion also shows checkboxes to narrow the sources for one run; clearing all
of them skips MyAgent for that ingest. A connected Webex delegation shows green,
with a small link to review source access in MyAgent settings. It is transport
readiness, not an assertion that external source permissions were inspected.

MyAgent answers in two sections: **Findings for the request** and **Project
relevance**. The project name is optional context, not a mandatory search term:
the requested information may be useful even when no source mentions the TOME
project. In that case MyAgent should state that no direct project match was found.

The backend checks the active run, its owner, current write access and unchanged
consent before each question and again before consuming a reply. The question
count and in-flight lock are enforced atomically across UI replicas. The model
cannot choose a different user, project or source set. Each question/answer is
saved in the run's protected evidence bundle rather than the shared run log.

When migrating a deployment that previously put the MyAgent app in
`WEBEX_CLIENT_ID` / `WEBEX_CLIENT_SECRET`, move those credentials into the new
`WEBEX_MYAGENT_*` fields and restore the original general Webex app credentials
before rollout. Preserve the app's registered callback, then have users
connect MyAgent separately (and reconnect general Webex if its app was rotated).

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
