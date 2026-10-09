/** Bounded read-only retrieval. The service asserts the authenticated caller. */
import { NextRequest } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { canReadTomeProject, isTomeAdminSubject } from "@/lib/tome/access";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { requireAgentToken, resolveProject } from "@/lib/tome/internal-api";
import { getPageStore } from "@/lib/tome/page-store";
import { buildTomeRetrievalScope } from "@/lib/tome/retrieval-scope";

export const dynamic = "force-dynamic";

function integer(value: string | null, fallback: number, maximum: number): number {
  const parsed = value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new ApiError("Invalid retrieval range", 400, "INVALID_RETRIEVAL_RANGE");
  }
  return parsed;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  requireAgentToken(request);
  if (!isTomeServerEnabled()) throw new ApiError("Not found", 404, "NOT_FOUND");
  const subject = request.headers.get("x-tome-actor-sub")?.trim();
  if (!subject) throw new ApiError("Caller identity is required", 403, "TOME_USER_REQUIRED");
  const query = request.nextUrl.searchParams;
  const scope = await buildTomeRetrievalScope(subject);
  if (query.get("scope_hash") !== scope.hash) {
    throw new ApiError("TOME access changed; start a new turn", 409, "TOME_SCOPE_CHANGED");
  }
  const operation = query.get("operation");
  if (operation === "scope") return Response.json({ scope_hash: scope.hash });
  const slug = query.get("project_slug") ?? "";
  const entry = scope.catalog.find((project) => project.slug === slug);
  if (!entry) throw new ApiError("Project is unavailable", 404, "PROJECT_NOT_FOUND");
  const project = await resolveProject(entry.project_id);
  if (!await isTomeAdminSubject(subject) && !await canReadTomeProject(subject, project)) {
    throw new ApiError("TOME read access is required", 403, "TOME_READ_REQUIRED");
  }
  const pages = await (await getPageStore()).listPages(project._id);
  const offset = integer(query.get("offset"), 0, 10_000_000);
  if (operation === "list_pages") {
    const paths = Object.keys(pages).sort();
    return Response.json({ paths: paths.slice(offset, offset + 200), total: paths.length, offset });
  }
  if (operation !== "read_page") throw new ApiError("Unknown retrieval operation", 400, "INVALID_OPERATION");
  const path = query.get("path") ?? "";
  if (!path || !Object.hasOwn(pages, path)) throw new ApiError("Page is unavailable", 404, "PAGE_NOT_FOUND");
  const limit = integer(query.get("limit"), 12_000, 24_000);
  if (!limit) throw new ApiError("Limit must be positive", 400, "INVALID_RETRIEVAL_RANGE");
  const markdown = pages[path];
  return Response.json({
    project_slug: slug, path, markdown: markdown.slice(offset, offset + limit),
    total_characters: markdown.length, offset, truncated: offset + limit < markdown.length,
    citation: `/projects/${encodeURIComponent(slug)}/tome/wiki/${path.split("/").map(encodeURIComponent).join("/")}`,
  });
});
