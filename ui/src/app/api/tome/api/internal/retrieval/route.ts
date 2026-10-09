/** Bounded read-only retrieval. The service asserts the authenticated caller. */
import { NextRequest } from "next/server";
import { createHash } from "crypto";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { canReadTomeProject, isTomeAdminSubject } from "@/lib/tome/access";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { requireAgentToken, resolveProject } from "@/lib/tome/internal-api";
import { getPageStore } from "@/lib/tome/page-store";
import { buildTomeRetrievalScope } from "@/lib/tome/retrieval-scope";
import { publishedTomeSnapshotResponse } from "@/lib/tome/retrieval-snapshot";
import { liveConfluenceEvidence } from "@/lib/tome/live-confluence";
import { getCollection } from "@/lib/mongodb";

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
  if (operation === "snapshot") return publishedTomeSnapshotResponse(subject, scope, request.signal);
  const slug = query.get("project_slug") ?? "";
  const entry = scope.catalog.find((project) => project.slug === slug);
  if (!entry) throw new ApiError("Project is unavailable", 404, "PROJECT_NOT_FOUND");
  const project = await resolveProject(entry.project_id);
  if (!await isTomeAdminSubject(subject) && !await canReadTomeProject(subject, project)) {
    throw new ApiError("TOME read access is required", 403, "TOME_READ_REQUIRED");
  }
  if (operation === "confluence_read" || operation === "confluence_search") {
    const grant = request.headers.get("x-tome-live-grant");
    if (!grant || !/^[0-9a-f]{64}$/.test(grant)) throw new ApiError("A live verification turn grant is required", 403, "TOME_LIVE_GRANT_REQUIRED");
    const sessions = await getCollection("tome_global_chat_sessions");
    const grantQuery = { live_grant_hash: createHash("sha256").update(grant).digest("hex"), owner_subject: subject,
      live_scope_hash: scope.hash, live_project_ids: entry.project_id, live_mode: query.get("live_mode"), lease_until: { $gt: new Date() } };
    if (!await sessions.findOne(grantQuery, { projection: { _id: 1 } })) throw new ApiError("Live verification grant expired or is outside scope", 403, "TOME_LIVE_GRANT_UNAVAILABLE");
    const result = await liveConfluenceEvidence(project, subject, operation, query);
    if ((await buildTomeRetrievalScope(subject)).hash !== scope.hash ||
        !await isTomeAdminSubject(subject) && !await canReadTomeProject(subject, project)) {
      throw new ApiError("TOME access changed during verification", 409, "TOME_SCOPE_CHANGED");
    }
    const latestProject = await resolveProject(entry.project_id);
    if (JSON.stringify(latestProject.sources) !== JSON.stringify(project.sources) ||
        !await sessions.findOne({ ...grantQuery, lease_until: { $gt: new Date() } }, { projection: { _id: 1 } })) {
      throw new ApiError("Source scope or live verification grant changed during the read", 409, "TOME_SCOPE_CHANGED");
    }
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
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

/** A body avoids URL limits when selecting a large authorized entity catalog. */
export const POST = withErrorHandler(async (request: NextRequest) => {
  requireAgentToken(request);
  if (!isTomeServerEnabled()) throw new ApiError("Not found", 404, "NOT_FOUND");
  const subject = request.headers.get("x-tome-actor-sub")?.trim();
  if (!subject) throw new ApiError("Caller identity is required", 403, "TOME_USER_REQUIRED");
  const scope = await buildTomeRetrievalScope(subject);
  if (request.nextUrl.searchParams.get("operation") !== "snapshot" || request.nextUrl.searchParams.get("scope_hash") !== scope.hash) {
    throw new ApiError("TOME access changed or the snapshot operation is invalid", 409, "TOME_SCOPE_CHANGED");
  }
  const input: unknown = await request.json();
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError("An entity selection object is required", 400, "INVALID_RETRIEVAL_SCOPE");
  }
  const body = input as { project_ids?: unknown };
  if (!Array.isArray(body.project_ids) || !body.project_ids.length || body.project_ids.length > 20_000 ||
      body.project_ids.some((id: unknown) => typeof id !== "string" || !id || id.length > 256)) {
    throw new ApiError("A bounded entity selection is required", 400, "INVALID_RETRIEVAL_SCOPE");
  }
  const selected = new Set<string>(body.project_ids);
  const catalog = scope.catalog.filter((entry) => selected.has(entry.project_id));
  if (catalog.length !== selected.size || selected.size !== body.project_ids.length) {
    throw new ApiError("Requested TOME scope is unavailable", 403, "TOME_READ_REQUIRED");
  }
  return publishedTomeSnapshotResponse(subject, { catalog, hash: scope.hash }, request.signal);
});
