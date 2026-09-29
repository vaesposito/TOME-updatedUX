import type { GitHubRepositorySource } from "@/types/projects";

const PICKER_PREFIX = "github-repo:";
const PUBLIC_GITHUB_WEB_BASE = "https://github.com";

function configuredValue(name: string): string {
  // NEXT_PUBLIC_GITHUB_HOST is useful to client components. Server-only
  // callers can use GITHUB_HOST/GITHUB_API_URL without exposing credentials.
  const env = typeof process !== "undefined" ? process.env : undefined;
  return (
    env?.[`NEXT_PUBLIC_${name}`]?.trim() ||
    env?.[name]?.trim() ||
    ""
  );
}

/** Base URL for the GitHub web UI, including GitHub Enterprise Server. */
export function githubWebBaseUrl(): string {
  const configuredHost = configuredValue("GITHUB_HOST");
  if (configuredHost) {
    return configuredHost.startsWith("http")
      ? configuredHost.replace(/\/+$/, "")
      : `https://${configuredHost.replace(/\/+$/, "")}`;
  }

  const api = configuredValue("GITHUB_API_URL");
  if (api && !/api\.github\.com/i.test(api)) {
    return api.replace(/\/api\/v3\/?$/i, "").replace(/\/+$/, "");
  }
  return PUBLIC_GITHUB_WEB_BASE;
}

/** REST API base URL, defaulting to public GitHub for backwards compatibility. */
export function githubApiBaseUrl(): string {
  const api = configuredValue("GITHUB_API_URL");
  if (api) return api.replace(/\/+$/, "");
  const web = githubWebBaseUrl();
  return web === PUBLIC_GITHUB_WEB_BASE ? "https://api.github.com" : `${web}/api/v3`;
}

/** GitHub Enterprise GraphQL is served at /api/graphql, not /api/v3/graphql. */
export function githubGraphqlUrl(): string {
  const configured = configuredValue("GITHUB_GRAPHQL_URL");
  if (configured) return configured.replace(/\/+$/, "");
  const web = githubWebBaseUrl();
  return web === PUBLIC_GITHUB_WEB_BASE
    ? `${githubApiBaseUrl()}/graphql`
    : `${web}/api/graphql`;
}

function repositoryPath(value: string): string {
  const trimmed = value.trim();
  // Preserve the legacy shorthand accepted by Tome preflight before this
  // parser was shared: `github.com/owner/repo` without a URL scheme.
  const githubHostShorthand = trimmed.match(/^(?:www\.)?github\.com\/(.+)$/i);
  if (githubHostShorthand) return githubHostShorthand[1];

  try {
    const url = new URL(trimmed);
    return url.pathname;
  } catch {
    return trimmed
      .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
      .replace(/^https?:\/\/[^/]+\//i, "");
  }
}

/** Normalize a GitHub URL or `owner/name` reference into `owner/name`. */
export function githubFullName(value: string): string {
  return repositoryPath(value)
    .replace(/[?#].*$/, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
}

export function githubHtmlUrl(fullName: string): string {
  return `${githubWebBaseUrl()}/${githubFullName(fullName)}`;
}

/** Best-effort structured source for legacy/manual repository values. */
export function githubSourceFromValue(value: string): GitHubRepositorySource {
  const fullName = githubFullName(value);
  let htmlUrl = githubHtmlUrl(fullName);
  try {
    const url = new URL(value.trim());
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      htmlUrl = `${url.origin}/${parts[0]}/${parts[1].replace(/\.git$/i, "")}`;
    }
  } catch {
    // Shorthand owner/name values use the configured GitHub web base.
  }
  return {
    full_name: fullName,
    html_url: htmlUrl,
  };
}

/** Picker-only encoding that carries the stable metadata through string[] UI APIs. */
export function encodeGitHubPickerValue(source: GitHubRepositorySource): string {
  return `${PICKER_PREFIX}${encodeURIComponent(JSON.stringify(source))}`;
}

/** Decode a picker value; legacy/manual strings remain fully supported. */
export function decodeGitHubPickerValue(value: string): GitHubRepositorySource {
  if (value.startsWith(PICKER_PREFIX)) {
    try {
      const parsed = JSON.parse(
        decodeURIComponent(value.slice(PICKER_PREFIX.length)),
      ) as Partial<GitHubRepositorySource>;
      if (typeof parsed.full_name === "string" && parsed.full_name.trim()) {
        const fullName = githubFullName(parsed.full_name);
        return {
          ...(typeof parsed.id === "number" && Number.isSafeInteger(parsed.id)
            ? { id: parsed.id }
            : {}),
          ...(typeof parsed.node_id === "string" && parsed.node_id.trim()
            ? { node_id: parsed.node_id.trim() }
            : {}),
          full_name: fullName,
          html_url:
            typeof parsed.html_url === "string" && parsed.html_url.trim()
              ? parsed.html_url.trim()
              : githubHtmlUrl(fullName),
          ...(typeof parsed.default_branch === "string" &&
          parsed.default_branch.trim()
            ? { default_branch: parsed.default_branch.trim() }
            : {}),
        };
      }
    } catch {
      // Fall through to legacy/manual parsing.
    }
  }
  return githubSourceFromValue(value);
}

/** Stable picker/deduplication key, preferring GitHub's immutable numeric ID. */
export function githubSourceKey(source: GitHubRepositorySource): string {
  return typeof source.id === "number"
    ? `id:${source.id}`
    : `name:${githubFullName(source.full_name).toLowerCase()}`;
}

/** Safe slug used by Tome's `repos/<slug>/` page paths. */
export function githubRepoSlug(source: GitHubRepositorySource): string {
  const parts = githubFullName(source.full_name).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** Validate and normalize untrusted API/PATCH input. */
export function normalizeGitHubRepositorySource(
  value: unknown,
): GitHubRepositorySource | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<GitHubRepositorySource>;
  const fullName =
    typeof candidate.full_name === "string"
      ? githubFullName(candidate.full_name)
      : "";
  if (!fullName || !fullName.includes("/")) return null;
  return {
    ...(typeof candidate.id === "number" && Number.isSafeInteger(candidate.id)
      ? { id: candidate.id }
      : {}),
    ...(typeof candidate.node_id === "string" && candidate.node_id.trim()
      ? { node_id: candidate.node_id.trim() }
      : {}),
    full_name: fullName,
    html_url:
      typeof candidate.html_url === "string" && candidate.html_url.trim()
        ? candidate.html_url.trim()
        : githubHtmlUrl(fullName),
    ...(typeof candidate.default_branch === "string" &&
    candidate.default_branch.trim()
      ? { default_branch: candidate.default_branch.trim() }
      : {}),
  };
}
