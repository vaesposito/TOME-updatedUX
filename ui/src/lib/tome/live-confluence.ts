/** Read-only, caller-scoped upstream evidence. Tokens remain in the BFF. */
import { createHash } from "crypto";

import { ApiError } from "@/lib/api-error";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import { resolveConfluenceSiteCredentials } from "@/lib/credentials/confluence-sites";
import { normalizeConfluenceSiteUrl, parseConfluenceUrl } from "@/lib/projects/confluence-source";
import { confluenceSearch, cqlQuote, type SearchContent } from "@/lib/projects/confluence-api";
import type { ProjectDocument } from "@/types/projects";
import { projectConfluenceSpaces } from "./agent-proxy";
import { readTomeAssistantSettings } from "./assistant-settings-store";

type Source = ReturnType<typeof projectConfluenceSpaces>[number];
const EXPAND = "content.space,content.ancestors,content.body.storage,content.version";

function allowed(source: Source, page: SearchContent): boolean {
  if (page.space?.key?.toUpperCase() !== source.space_key.toUpperCase()) return false;
  const roots = source.page_scopes?.length ? source.page_scopes : source.root_page_id
    ? [{ page_id: source.root_page_id, include_descendants: source.include_descendants !== false }] : [];
  return !roots.length || roots.some((root) => page.id === root.page_id || root.include_descendants &&
    page.ancestors?.some((ancestor) => ancestor.id === root.page_id));
}

function restriction(source: Source): string {
  const roots = source.page_scopes?.length ? source.page_scopes : source.root_page_id
    ? [{ page_id: source.root_page_id, include_descendants: source.include_descendants !== false }] : [];
  if (roots.some((root) => !/^\d+$/.test(root.page_id))) throw new ApiError("Invalid configured page scope", 400, "CONFLUENCE_SCOPE_INVALID");
  return `(space="${cqlQuote(source.space_key)}"${roots.length ? " and (" + roots.map((root) =>
    `id=${root.page_id}${root.include_descendants ? ` or ancestor=${root.page_id}` : ""}`).join(" or ") + ")" : ""})`;
}

export async function liveConfluenceEvidence(
  project: ProjectDocument,
  subject: string,
  operation: "confluence_read" | "confluence_search",
  args: URLSearchParams,
): Promise<Record<string, unknown>> {
  const mode = (await readTomeAssistantSettings()).tome_live_verification_mode;
  if (mode === "off" || args.get("live_mode") === "automatic" && mode !== "automatic") {
    throw new ApiError("Live verification is disabled or its policy changed", 409, "TOME_LIVE_VERIFICATION_DISABLED");
  }
  const configured = projectConfluenceSpaces(project);
  if (configured.length > 5) return { status: "unverified", reason: "Too many configured Confluence sources for one verification request." };
  const url = operation === "confluence_read" ? parseConfluenceUrl(args.get("url") ?? "") : null;
  if (operation === "confluence_read" && !url?.page_id) {
    throw new ApiError("A configured Confluence page URL is required", 400, "CONFLUENCE_URL_INVALID");
  }
  let sources: Source[];
  try {
    sources = configured.filter((source) => !url || normalizeConfluenceSiteUrl(source.base_url) === url.base_url);
  } catch {
    return { status: "unverified", reason: "A configured Confluence site URL is invalid. Update the project's sources." };
  }
  if (!sources.length) return { status: "unverified", reason: "No matching Confluence source is configured for this project." };
  const offset = Number(args.get("offset") ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
    throw new ApiError("Invalid Confluence body offset", 400, "CONFLUENCE_RANGE_INVALID");
  }
  const query = args.get("query")?.trim() ?? "";
  if (operation === "confluence_search" && (!query || query.length > 256)) {
    throw new ApiError("A search query of at most 256 characters is required", 400, "CONFLUENCE_QUERY_INVALID");
  }
  try {
    const service = await getProviderConnectionService();
    const sites = await resolveConfluenceSiteCredentials(service,
      await service.listConnections({ type: "user", id: subject }), sources.map((source) => source.base_url));
    const groups = [...new Set(sources.map((source) => normalizeConfluenceSiteUrl(source.base_url)))];
    const results = await Promise.all(groups.map(async (site) => {
      const scoped = sources.filter((source) => normalizeConfluenceSiteUrl(source.base_url) === site);
      const binding = sites[site];
      const cql = operation === "confluence_read" ? `id=${url!.page_id} and type=page`
        : `type=page and (${scoped.map(restriction).join(" or ")}) and text~"${cqlQuote(query)}" order by lastmodified desc`;
      const data = await confluenceSearch(`https://api.atlassian.com/ex/confluence/${encodeURIComponent(binding.cloud_id)}`,
        binding.access_token, cql, operation === "confluence_read" ? 1 : 6, undefined,
        operation === "confluence_read" ? EXPAND : "content.space,content.ancestors,content.version");
      return { site, scoped, data };
    }));
    if (operation === "confluence_search") {
      const matches = results.flatMap(({ site, scoped, data }) => (data.results ?? [])
        .filter((result) => /^\d+$/.test(result.content?.id ?? "") && scoped.some((source) => allowed(source, result.content!)))
        .map((result) => ({ title: result.content?.title || result.title,
          url: `${site}/wiki/spaces/${encodeURIComponent(result.content!.space!.key!)}/pages/${result.content!.id}`,
          source_version: result.content?.version?.number ?? null, source_revision_at: result.content?.version?.when ?? result.lastModified ?? null })));
      return { status: "discovered", results: matches.slice(0, 12),
        truncated: matches.length > 12 || results.some(({ data }) => Boolean(data._links?.next)),
        warning: "Search results are discovery only; read complete pages before verifying claims." };
    }
    const { site, scoped, data } = results[0];
    const page = data.results?.[0]?.content;
    if (!page || page.id !== url!.page_id || !scoped.some((source) => allowed(source, page))) {
      return { status: "unverified", reason: "Page is unavailable or outside this project's configured source scope." };
    }
    const body = page.body?.storage?.value;
    if (typeof body !== "string" || !Number.isSafeInteger(page.version?.number) || (page.version?.number ?? 0) < 1 ||
        typeof page.version?.when !== "string" || Number.isNaN(Date.parse(page.version.when))) {
      return { status: "unverified", reason: "Confluence did not return a complete storage body with revision metadata." };
    }
    if (body.length > 1_000_000) return { status: "unverified", reason: "Page exceeds the verification budget." };
    // Wire offsets count Unicode code points, matching the native Python reader.
    const characters = Array.from(body);
    if (offset > characters.length) return { status: "unverified", reason: "Page offset is invalid." };
    const revision = createHash("sha256").update(JSON.stringify([site, page.id, page.version, body])).digest("hex");
    if (offset > 0 && args.get("content_revision") !== revision) return { status: "unverified", reason: "Page revision changed; restart its live read." };
    const end = Math.min(characters.length, offset + 24_000);
    return { status: "read", title: page.title, url: `${site}/wiki/spaces/${encodeURIComponent(page.space!.key!)}/pages/${page.id}`,
      body: characters.slice(offset, end).join(""), offset, total_chars: characters.length, next_offset: end < characters.length ? end : null,
      content_revision: revision, source_version: page.version.number, source_revision_at: page.version.when,
      read_at: new Date().toISOString(), warning: "A successful read is source evidence, not a claim-correctness verdict." };
  } catch (error) {
    // Never return provider payloads or token-bearing exceptions to the model.
    return { status: "unverified", reason: error instanceof ApiError ? error.message : "Confluence verification could not finish. Reconnect Atlassian or retry." };
  }
}
