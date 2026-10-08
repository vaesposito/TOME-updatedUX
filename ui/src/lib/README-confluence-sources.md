# Confluence project sources (BFF library)

A Tome project can attach up to 5 Confluence spaces, each with its own page
scope. Stored at `sources.confluence_spaces` on the project document.

## Entry shape

| Field | Notes |
|-------|-------|
| `slug` | Stable per-project id. Collisions get a `-2`, `-3` suffix. |
| `name` | Display name. Defaults to `space_key`. |
| `space_key` | Required. |
| `base_url` | Optional. Site root, e.g. `https://example.atlassian.net`. |
| `page_scopes` | Optional. `{page_id, page_title, space_key, include_descendants}` entries that narrow what the agent reads. Confluence permissions stay the authorization boundary. |

## Rules

- Cap is `MAX_CONFLUENCE_SOURCES_PER_PROJECT` (5).
- Duplicates (same `base_url` + `space_key`) are dropped.
- `normalizeConfluenceSpaces` enforces all of the above; call it before saving.
- A project with only the legacy `sources.confluence_url` still works and reads
  as one space.

## Library files

| File | Responsibility |
|------|----------------|
| `projects/confluence-source.ts` | `normalizeConfluenceSpaces`, URL parsing, and the encode/decode helpers that let the generic source picker carry a space as a string. |
| `tome/agent-proxy.ts` | Builds the agent snapshot from `confluence_spaces` (`projectConfluenceSpaces`), falling back to the legacy `confluence_url`. Uses `slugifyConfluenceSpaceKey` for the wiki folder name. |

## Routes

| Route | Role |
|-------|------|
| `api/projects` | Normalizes and persists `confluence_spaces` on create. |
| `api/projects/[slug]` | Persists `confluence_spaces` on PATCH and audits each added or removed space (`tome.source.attach` / `tome.source.detach`, source type `confluence`). |
| `api/projects/confluence/resolve` | Validates a space exists (CQL) and lists pages, returning `has_children` so the picker hides expanders on leaf pages. |
| `api/tome/mcp` | The two MCP tools below. |

## MCP tools

| Tool | Behavior |
|------|----------|
| `tome_add_confluence_space` | Appends a space. Rejects unparseable URLs, duplicates, and a sixth space. A legacy `confluence_url` becomes the first entry. |
| `tome_list_confluence_spaces` | Returns the URL of every attached space. |
