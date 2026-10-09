import { ApiError } from "@/lib/api-error";
import { normalizeConfluenceSiteUrl } from "@/lib/projects/confluence-source";
import type { ProviderConnectionMetadata, ProviderConnectionService } from "./oauth-service";

export interface ConfluenceSiteCredential {
  cloud_id: string;
  access_token: string;
  expires_in?: string;
}

/** Read one server-owned binding; a legacy binding must match the same site. */
export function forwardedConfluenceSiteCredential(
  entry: Record<string, string> | undefined,
  siteUrl: string,
): ConfluenceSiteCredential | undefined {
  if (!entry) return undefined;
  try {
    const site = normalizeConfluenceSiteUrl(siteUrl);
    const binding = entry.confluence_sites
      ? (JSON.parse(entry.confluence_sites) as Record<string, ConfluenceSiteCredential>)[site]
      : entry.site_url && normalizeConfluenceSiteUrl(entry.site_url) === site ? entry : undefined;
    if (binding && typeof binding.cloud_id === "string" && binding.cloud_id &&
        typeof binding.access_token === "string" && binding.access_token) return binding as ConfluenceSiteCredential;
  } catch {
    return undefined;
  }
  return undefined;
}

/** Resolve only configured sites using connections owned by the calling user. */
export async function resolveConfluenceSiteCredentials(
  service: ProviderConnectionService,
  connections: ProviderConnectionMetadata[],
  siteUrls: string[],
): Promise<Record<string, ConfluenceSiteCredential>> {
  let required: Set<string>;
  try {
    required = new Set(siteUrls.map(normalizeConfluenceSiteUrl));
  } catch {
    throw new ApiError("A configured Confluence source has an invalid HTTPS site URL. Update the project's sources.",
      400, "CONFLUENCE_SITE_INVALID");
  }
  const resolved: Record<string, ConfluenceSiteCredential> = {};
  const connected = connections.filter((connection) => connection.provider === "atlassian" && connection.status === "connected");
  if (!connected.length) {
    throw new ApiError("Connect Atlassian in Credentials → Connections to access this project's Confluence sites.",
      409, "ATLASSIAN_NOT_CONNECTED");
  }
  let discoveryFailed = false;
  for (const connection of connected) {
    let accessToken: string;
    let expiresIn: number | undefined;
    let resources: unknown;
    try {
      const refreshed = await service.refreshConnection(connection.id);
      accessToken = refreshed.accessToken;
      expiresIn = refreshed.expiresIn;
      if (!accessToken) throw new Error("Connection has no access token");
      const response = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        cache: "no-store", signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error("Accessible resources request failed");
      resources = await response.json();
      if (!Array.isArray(resources)) throw new Error("Accessible resources response is invalid");
    } catch {
      // Another caller-owned connection can authorize the remaining sites.
      discoveryFailed = true;
      continue;
    }
    for (const resource of resources as unknown[]) {
      if (!resource || typeof resource !== "object") continue;
      const { id, url, scopes } = resource as Record<string, unknown>;
      if (typeof id !== "string" || !id.trim() || typeof url !== "string" ||
          !Array.isArray(scopes) || !scopes.some((scope) => typeof scope === "string" && scope.includes("confluence"))) continue;
      let site: string;
      try { site = normalizeConfluenceSiteUrl(url); } catch { continue; }
      if (!required.has(site)) continue;
      if (resolved[site] && resolved[site].cloud_id !== id) {
        throw new ApiError(`Multiple cloud IDs were returned for ${site}. Reconnect Atlassian before retrying.`,
          409, "CONFLUENCE_SITE_AMBIGUOUS");
      }
      resolved[site] ??= { cloud_id: id, access_token: accessToken,
        ...(typeof expiresIn === "number" && expiresIn > 0 ? { expires_in: String(expiresIn) } : {}) };
    }
  }
  const missing = [...required].filter((site) => !resolved[site]);
  if (missing.length) {
    throw new ApiError(discoveryFailed
      ? `Could not verify Confluence access to ${missing.join(", ")}. Reconnect Atlassian and retry.`
      : `Your connected Atlassian credentials do not grant Confluence access to ${missing.join(", ")}. Authorize those sites in Connections.`,
    discoveryFailed ? 502 : 409, discoveryFailed ? "ATLASSIAN_RESOURCES_FAILED" : "CONFLUENCE_SITE_MISMATCH");
  }
  return resolved;
}
