import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import { resolveConfluenceSiteCredentials } from "@/lib/credentials/confluence-sites";
import {
  parseConfluenceUrl,
  type ConfluenceTreePage,
} from "@/lib/projects/confluence-source";

import { fetchConfluenceSpace, collectConfluencePages, confluenceSearch, cqlQuote, type SearchContent } from "@/lib/projects/confluence-api";

const MAX_PAGES = 500;

function hasChildren(content: SearchContent): boolean | undefined {
  const value = content.childTypes?.page?.value;
  return typeof value === "boolean" ? value : undefined;
}

function pageUrl(siteUrl: string, spaceKey: string, pageId: string): string {
  return `${siteUrl.replace(/\/$/, "")}/wiki/spaces/${encodeURIComponent(spaceKey)}/pages/${pageId}`;
}

function spaceUrl(siteUrl: string, spaceKey: string): string {
  return `${siteUrl.replace(/\/$/, "")}/wiki/spaces/${encodeURIComponent(spaceKey)}`;
}

function orderForest(pages: ConfluenceTreePage[]): ConfluenceTreePage[] {
  const known = new Set(pages.map((page) => page.id));
  const children = new Map<string, ConfluenceTreePage[]>();
  for (const page of pages) {
    const parentId =
      page.parent_id && known.has(page.parent_id) ? page.parent_id : "";
    const siblings = children.get(parentId) ?? [];
    siblings.push(page);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.title.localeCompare(b.title));
  }

  const ordered: ConfluenceTreePage[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string, depth: number) => {
    for (const page of children.get(parentId) ?? []) {
      if (visited.has(page.id)) continue;
      visited.add(page.id);
      ordered.push({ ...page, depth });
      visit(page.id, depth + 1);
    }
  };
  visit("", 0);
  for (const page of pages) {
    if (!visited.has(page.id)) {
      ordered.push({ ...page, parent_id: null, depth: 0 });
      visit(page.id, 1);
    }
  }
  return ordered;
}

function orderTree(
  root: ConfluenceTreePage,
  descendants: ConfluenceTreePage[],
): ConfluenceTreePage[] {
  const known = new Set([root.id, ...descendants.map((page) => page.id)]);
  const children = new Map<string, ConfluenceTreePage[]>();
  for (const page of descendants) {
    const parentId =
      page.parent_id && known.has(page.parent_id) ? page.parent_id : root.id;
    const siblings = children.get(parentId) ?? [];
    siblings.push(page);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.title.localeCompare(b.title));
  }

  const ordered: ConfluenceTreePage[] = [root];
  const visit = (parentId: string, depth: number) => {
    for (const page of children.get(parentId) ?? []) {
      ordered.push({ ...page, depth });
      visit(page.id, depth + 1);
    }
  };
  visit(root.id, 1);
  return ordered;
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  const sub = (session as { sub?: string } | undefined)?.sub;
  if (!sub) {
    throw new ApiError(
      "Sign in to preview Confluence pages",
      401,
      "UNAUTHORIZED",
    );
  }

  const body = (await request.json().catch(() => ({}))) as { url?: unknown };
  const parsed =
    typeof body.url === "string" ? parseConfluenceUrl(body.url) : null;
  if (!parsed || (!parsed.page_id && !parsed.space_key)) {
    throw new ApiError(
      "Paste a Confluence space or page URL",
      400,
      "INVALID_CONFLUENCE_URL",
    );
  }

  const service = await getProviderConnectionService();
  const credentials = await resolveConfluenceSiteCredentials(
    service, await service.listConnections({ type: "user", id: sub }), [parsed.base_url],
  );
  const binding = credentials[parsed.base_url];
  const token = binding.access_token;
  const site = { id: binding.cloud_id, url: parsed.base_url };

  const gateway = `https://api.atlassian.com/ex/confluence/${encodeURIComponent(site.id)}`;
  if (!parsed.page_id && parsed.space_key) {
    const space = await fetchConfluenceSpace(gateway, token, parsed.space_key);
    if (!space?.key) {
      throw new ApiError(
        "Space not found or not accessible",
        404,
        "CONFLUENCE_SPACE_NOT_FOUND",
      );
    }
    const resolvedSpaceKey = space.key;
    const pageSearch = await collectConfluencePages(
      gateway,
      token,
      `space="${cqlQuote(resolvedSpaceKey)}" and type=page`,
      MAX_PAGES,
    );
    const found: Array<{ page: ConfluenceTreePage; ancestorIds: string[] }> = [];
    for (const result of pageSearch.results) {
      const content = result.content;
      if (!content?.id) continue;
      found.push({
        page: {
          id: content.id,
          title: content.title || result.title || `Page ${content.id}`,
          parent_id: null,
          depth: 0,
          url: pageUrl(site.url, resolvedSpaceKey, content.id),
          has_children: hasChildren(content),
        },
        ancestorIds: (content.ancestors ?? [])
          .map((ancestor) => ancestor.id)
          .filter((id): id is string => Boolean(id)),
      });
    }

    const known = new Set(found.map(({ page }) => page.id));
    const pages = orderForest(
      found.map(({ page, ancestorIds }) => ({
        ...page,
        parent_id:
          [...ancestorIds].reverse().find((id) => known.has(id)) ?? null,
      })),
    );
    return successResponse({
      kind: "space",
      source_url: spaceUrl(site.url, resolvedSpaceKey),
      space_key: resolvedSpaceKey,
      pages,
      truncated: pageSearch.truncated,
    });
  }

  const rootSearch = await confluenceSearch(
    gateway,
    token,
    `id=${parsed.page_id}`,
    1,
  );
  const rootResult = rootSearch.results?.[0];
  const rootContent = rootResult?.content;
  const spaceKey = rootContent?.space?.key;
  if (!rootContent?.id || !spaceKey) {
    throw new ApiError(
      "Page not found or not accessible",
      404,
      "CONFLUENCE_PAGE_NOT_FOUND",
    );
  }
  const rootId = rootContent.id;
  const rootTitle = rootContent.title || rootResult.title || `Page ${rootId}`;
  const descendants: ConfluenceTreePage[] = [];
  const descendantSearch = await collectConfluencePages(
    gateway,
    token,
    `ancestor=${rootId} and type=page`,
    MAX_PAGES,
  );
  for (const result of descendantSearch.results) {
    const content = result.content;
    if (
      !content?.id ||
      content.space?.key?.toLocaleUpperCase() !== spaceKey.toLocaleUpperCase()
    ) {
      continue;
    }
    const ancestors = content.ancestors ?? [];
    const rootIndex = ancestors.findIndex((ancestor) => ancestor.id === rootId);
    if (rootIndex < 0) continue;
    const parentId =
      [...ancestors].reverse().find((ancestor) => ancestor.id)?.id ?? rootId;
    descendants.push({
      id: content.id,
      title: content.title || result.title || `Page ${content.id}`,
      parent_id: parentId,
      depth: ancestors.length - rootIndex,
      url: pageUrl(site.url, spaceKey, content.id),
      has_children: hasChildren(content),
    });
  }

  const root: ConfluenceTreePage = {
    id: rootId,
    title: rootTitle,
    parent_id: null,
    depth: 0,
    url: pageUrl(site.url, spaceKey, rootId),
    has_children: hasChildren(rootContent),
  };
  const pages = orderTree(root, descendants);
  return successResponse({
    kind: "page",
    // Page IDs remain stable when Confluence pages move between spaces, while
    // the space segment in an old copied URL can become stale. The resolved
    // page metadata is authoritative, so persist a canonical URL instead of
    // rejecting an otherwise accessible page.
    source_url: root.url,
    scope: {
      page_id: rootId,
      page_title: rootTitle,
      space_key: spaceKey,
      include_descendants: true,
    },
    pages,
    truncated: descendantSearch.truncated,
  });
});
