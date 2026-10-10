import { ApiError } from "@/lib/api-error";

const PAGE_LIMIT = 100;

export interface SearchContent {
  id?: string;
  title?: string;
  space?: { key?: string };
  ancestors?: Array<{ id?: string; title?: string }>;
  childTypes?: { page?: { value?: boolean } };
  body?: { storage?: { value?: string } };
  version?: { number?: number; when?: string };
}

export interface SearchResult {
  title?: string;
  content?: SearchContent;
  space?: { key?: string };
  lastModified?: string;
}

export interface SearchResponse {
  results?: SearchResult[];
  _links?: { next?: string };
}

export function cqlQuote(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function confluenceSearch(
  gateway: string,
  token: string,
  cql: string,
  limit: number,
  nextLink?: string,
  expand = "content.space,content.ancestors,content.childTypes.page",
): Promise<SearchResponse> {
  const params = nextLink
    ? new URL(nextLink, "https://confluence-pagination.invalid").searchParams
    : new URLSearchParams();
  if (!params.has("cql")) params.set("cql", cql);
  if (!params.has("expand")) {
    params.set(
      "expand",
      expand,
    );
  }
  if (!params.has("limit")) params.set("limit", String(limit));
  const response = await fetch(`${gateway}/wiki/rest/api/search?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store", signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(
      "Your Atlassian connection cannot read this page",
      403,
      "CONFLUENCE_PAGE_FORBIDDEN",
    );
  }
  if (!response.ok) {
    throw new ApiError(
      `Confluence page lookup failed (${response.status})`,
      502,
      "CONFLUENCE_LOOKUP_FAILED",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError("Confluence returned an empty response", 502, "CONFLUENCE_RESPONSE_INVALID");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8 * 1024 * 1024) {
        await reader.cancel();
        throw new ApiError("Confluence response exceeds the safe read budget", 413, "CONFLUENCE_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as SearchResponse;
  if (!data || !Array.isArray(data.results)) throw new ApiError("Confluence returned invalid search results", 502, "CONFLUENCE_RESPONSE_INVALID");
  return data;
}

// v1 `/rest/api/space/{key}` is retired and v2 `/wiki/api/v2/spaces?keys=`
// 403s on a viewable-but-not-joined space, so check existence via CQL
// search against `type=space`, same as the space directory does.
export async function fetchConfluenceSpace(
  gateway: string,
  token: string,
  spaceKey: string,
): Promise<{ key: string } | null> {
  const search = await confluenceSearch(
    gateway,
    token,
    `type=space and space.key="${cqlQuote(spaceKey)}"`,
    1,
  );
  const key = search.results?.[0]?.space?.key;
  return key ? { key } : null;
}

export async function collectConfluencePages(
  gateway: string,
  token: string,
  cql: string,
  maxPages: number,
): Promise<{ results: SearchResult[]; truncated: boolean }> {
  const results: SearchResult[] = [];
  const seenPageIds = new Set<string>();
  const seenNextLinks = new Set<string>();
  let nextLink: string | undefined;

  while (results.length < maxPages) {
    const data = await confluenceSearch(
      gateway,
      token,
      cql,
      Math.min(PAGE_LIMIT, maxPages - results.length),
      nextLink,
    );
    for (const result of data.results ?? []) {
      const pageId = result.content?.id;
      if (!pageId || seenPageIds.has(pageId)) continue;
      seenPageIds.add(pageId);
      results.push(result);
      if (results.length >= maxPages) break;
    }

    const returnedNext = data._links?.next;
    if (!returnedNext) {
      return { results, truncated: false };
    }
    if (seenNextLinks.has(returnedNext)) {
      return { results, truncated: true };
    }
    seenNextLinks.add(returnedNext);
    nextLink = returnedNext;
  }

  return { results, truncated: Boolean(nextLink) };
}
