import type { ConfluencePageScope, ConfluenceSpaceSource } from "@/types/projects";

export const MAX_CONFLUENCE_SOURCES_PER_PROJECT = 5;

export interface ParsedConfluenceUrl {
  url: string;
  base_url: string;
  space_key?: string;
  page_id?: string;
}

export interface ConfluenceTreePage {
  id: string;
  title: string;
  parent_id: string | null;
  depth: number;
  url: string;
  has_children?: boolean;
}

export interface ConfluenceSourcePreview {
  kind: "page";
  source_url: string;
  scope: ConfluencePageScope;
  pages: ConfluenceTreePage[];
  truncated: boolean;
}

export interface ConfluenceSpacePreview {
  kind: "space";
  source_url: string;
  space_key: string;
  pages: ConfluenceTreePage[];
  truncated: boolean;
}

/** Parse the stable identifiers carried by common Confluence Cloud URL forms. */
export function parseConfluenceUrl(input: string): ParsedConfluenceUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const spaceMatch = url.pathname.match(/\/wiki\/spaces\/([^/?#]+)/i);
  const modernPageMatch = url.pathname.match(
    /\/wiki\/spaces\/[^/?#]+\/pages\/(\d+)(?:\/|$)/i,
  );
  const compactPageMatch = url.pathname.match(/\/wiki\/pages\/(\d+)(?:\/|$)/i);
  const legacyPageId =
    /\/wiki\/pages\/viewpage\.action$/i.test(url.pathname)
      ? url.searchParams.get("pageId")
      : null;
  const pageId =
    modernPageMatch?.[1] ??
    compactPageMatch?.[1] ??
    (legacyPageId && /^\d+$/.test(legacyPageId) ? legacyPageId : undefined);

  return {
    url: trimmed,
    base_url: url.origin,
    space_key: spaceMatch ? decodeURIComponent(spaceMatch[1]) : undefined,
    page_id: pageId,
  };
}

export function isConfluencePageUrl(input: string): boolean {
  return Boolean(parseConfluenceUrl(input)?.page_id);
}

export function normalizeConfluencePageScope(
  value: unknown,
): ConfluencePageScope | undefined {
  if (!value || typeof value !== "object") return undefined;
  const scope = value as Record<string, unknown>;
  const pageId =
    typeof scope.page_id === "string" ? scope.page_id.trim() : "";
  const pageTitle =
    typeof scope.page_title === "string" ? scope.page_title.trim() : "";
  const spaceKey =
    typeof scope.space_key === "string" ? scope.space_key.trim() : "";
  if (!/^\d+$/.test(pageId) || !pageTitle || !spaceKey) return undefined;
  return {
    page_id: pageId,
    page_title: pageTitle,
    space_key: spaceKey,
    include_descendants: scope.include_descendants !== false,
  };
}

/** Normalize, deduplicate, and bound a multi-root Confluence page selection. */
export function normalizeConfluencePageScopes(
  value: unknown,
): ConfluencePageScope[] {
  if (!Array.isArray(value)) return [];
  const scopes: ConfluencePageScope[] = [];
  const seen = new Set<string>();
  for (const candidate of value.slice(0, 100)) {
    const scope = normalizeConfluencePageScope(candidate);
    if (!scope || seen.has(scope.page_id)) continue;
    seen.add(scope.page_id);
    scopes.push(scope);
  }
  return scopes;
}

interface DecodedConfluenceSource {
  url: string;
  base_url: string;
  space_key: string;
  name: string;
  page_scopes: ConfluencePageScope[];
  /** Carried through unchanged, so re-saving doesn't lose a disambiguating suffix `normalizeConfluenceSpaces` assigned earlier. */
  slug?: string;
}

/** Packs a space's identity and scope into the picker's `string[]` contract — mirrors `encodeWebexRoom`/`decodeWebexRoom`. */
export function encodeConfluenceSource(entry: {
  url: string;
  base_url: string;
  space_key: string;
  name: string;
  page_scopes?: ConfluencePageScope[];
  slug?: string;
}): string {
  return JSON.stringify({
    url: entry.url,
    base_url: entry.base_url,
    space_key: entry.space_key,
    name: entry.name,
    page_scopes: entry.page_scopes ?? [],
    ...(entry.slug ? { slug: entry.slug } : {}),
  });
}

/** Tolerates a bare URL (legacy/manual entry) by re-deriving what it can from it. */
export function decodeConfluenceSource(value: string): DecodedConfluenceSource {
  try {
    const o = JSON.parse(value) as Partial<DecodedConfluenceSource> & { url?: unknown };
    if (o && typeof o.url === "string" && o.url) {
      const parsed = parseConfluenceUrl(o.url);
      const spaceKey =
        typeof o.space_key === "string" && o.space_key
          ? o.space_key
          : parsed?.space_key ?? "";
      return {
        url: o.url,
        base_url:
          typeof o.base_url === "string" && o.base_url
            ? o.base_url
            : parsed?.base_url ?? "",
        space_key: spaceKey,
        name: typeof o.name === "string" && o.name ? o.name : spaceKey || o.url,
        page_scopes: Array.isArray(o.page_scopes)
          ? normalizeConfluencePageScopes(o.page_scopes)
          : [],
        ...(typeof o.slug === "string" && o.slug ? { slug: o.slug } : {}),
      };
    }
  } catch {
    /* not JSON — treat as a bare URL */
  }
  const parsed = parseConfluenceUrl(value);
  return {
    url: value,
    base_url: parsed?.base_url ?? "",
    space_key: parsed?.space_key ?? "",
    name: parsed?.space_key ?? value,
    page_scopes: [],
  };
}

export function slugifyConfluenceSpaceKey(value: string): string {
  return (value || "")
    .normalize("NFKD")
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function confluenceSourceSlug(spaceKey: string): string {
  return slugifyConfluenceSpaceKey(spaceKey).slice(0, 48) || "space";
}

export function toConfluenceSpaceSource(value: string): ConfluenceSpaceSource {
  const decoded = decodeConfluenceSource(value);
  return {
    slug:
      decoded.slug ||
      confluenceSourceSlug(decoded.space_key || decoded.name || decoded.url),
    name: decoded.name,
    space_key: decoded.space_key,
    ...(decoded.base_url ? { base_url: decoded.base_url } : {}),
    ...(decoded.page_scopes.length ? { page_scopes: decoded.page_scopes } : {}),
  };
}

export function confluenceSpaceUrl(s: ConfluenceSpaceSource): string {
  return s.base_url && s.space_key
    ? `${s.base_url}/wiki/spaces/${encodeURIComponent(s.space_key)}`
    : s.base_url ?? "";
}

export function confluenceSourceToPickerValue(s: ConfluenceSpaceSource): string {
  const url = confluenceSpaceUrl(s);
  const pageScopes = s.page_scopes?.length
    ? s.page_scopes
    : s.page_scope
      ? [s.page_scope]
      : [];
  return encodeConfluenceSource({
    url,
    base_url: s.base_url ?? "",
    space_key: s.space_key,
    name: s.name,
    page_scopes: pageScopes,
    slug: s.slug,
  });
}

function normalizeConfluenceSpace(value: unknown): ConfluenceSpaceSource | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const spaceKey = typeof v.space_key === "string" ? v.space_key.trim() : "";
  if (!spaceKey) return undefined;
  const baseUrl = typeof v.base_url === "string" ? v.base_url.trim() : "";
  const name = typeof v.name === "string" && v.name.trim() ? v.name.trim() : spaceKey;
  const pageScopes = normalizeConfluencePageScopes(v.page_scopes);
  const slug =
    typeof v.slug === "string" && v.slug.trim()
      ? v.slug.trim()
      : confluenceSourceSlug(spaceKey);
  return {
    slug,
    name,
    space_key: spaceKey,
    ...(baseUrl ? { base_url: baseUrl } : {}),
    ...(pageScopes.length ? { page_scopes: pageScopes } : {}),
  };
}

/** Dedupes by base_url+space_key, disambiguates slug collisions, and caps at `MAX_CONFLUENCE_SOURCES_PER_PROJECT`. */
export function normalizeConfluenceSpaces(value: unknown): ConfluenceSpaceSource[] {
  if (!Array.isArray(value)) return [];
  const result: ConfluenceSpaceSource[] = [];
  const seenKey = new Set<string>();
  const slugCounts = new Map<string, number>();
  for (const candidate of value) {
    if (result.length >= MAX_CONFLUENCE_SOURCES_PER_PROJECT) break;
    const space = normalizeConfluenceSpace(candidate);
    if (!space) continue;
    const dedupeKey = `${space.base_url ?? ""}::${space.space_key}`;
    if (seenKey.has(dedupeKey)) continue;
    seenKey.add(dedupeKey);
    const count = slugCounts.get(space.slug) ?? 0;
    slugCounts.set(space.slug, count + 1);
    result.push(count > 0 ? { ...space, slug: `${space.slug}-${count + 1}` } : space);
  }
  return result;
}
