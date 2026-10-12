// Tome single-page CRUD — nested under a CAIPE project slug.
//
//   GET    /api/tome/projects/[slug]/pages/[...path]  → one page
//   PUT    /api/tome/projects/[slug]/pages/[...path]  → write (editor)
//   DELETE /api/tome/projects/[slug]/pages/[...path]  → tombstone (editor)
//
// `[...path]` is the page path under the project, e.g. `charter.md` or
// `repos/mycelium/overview.md`.

import { NextRequest, NextResponse } from "next/server";

import {
  ApiError,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { loadTomeProject, requireTomeEditor, guardNotLocked } from "@/lib/tome/tome-api";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { getPageStore } from "@/lib/tome/page-store";
import { PageNotFoundError } from "@/lib/tome/mongo-page-store";
import { AGENT_IDENTITIES } from "@/lib/tome/agent-identities";
import { sessionSub } from "@/lib/tome/agent-proxy";
import {
  notifyPageSaved,
  parsePageNotifySelection,
} from "@/lib/tome/page-notifications";
import { parseFrontmatter } from "@/lib/tome/schema";
import { SPEC_BY_PATH } from "@/lib/tome/schema";
import type { PageKind, PageResponse } from "@/types/tome";
import { currentLiveRevision, hasPageEditConflict } from "@/lib/tome/revision-conflict";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; path: string[] }> };

function pagePathFrom(parts: string[]): string {
  // Next has already URL-decoded each segment; rejoin to the stored path.
  return parts.join("/");
}

function toResponse(path: string, markdown: string): PageResponse {
  const [fm] = parseFrontmatter(markdown);
  const spec = SPEC_BY_PATH.get(path);
  const title = String(fm.title ?? spec?.title ?? path);
  const kind = (typeof fm.kind === "string" ? fm.kind : spec?.kind ?? "stable") as PageKind;
  return { path, markdown, title, kind };
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, path } = await ctx.params;
  const { projectId } = await loadTomeProject(request, slug);
  const pagePath = pagePathFrom(path);

  const store = await getPageStore();
  try {
    const markdown = await store.readPage(projectId, pagePath);
    return successResponse(toResponse(pagePath, markdown));
  } catch (err) {
    if (err instanceof PageNotFoundError) {
      throw new ApiError("Page not found", 404, "PAGE_NOT_FOUND");
    }
    throw err;
  }
});

export const PUT = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, path } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  await guardNotLocked(tctx.projectId, tctx.project.locked ?? false);
  const pagePath = pagePathFrom(path);

  const body = (await request.json().catch(() => ({}))) as {
    markdown?: string;
    message?: string;
    base_revision_id?: string | null;
    force?: boolean;
    notify?: unknown;
  };
  if (typeof body.markdown !== "string") {
    throw new ApiError("`markdown` (string) is required", 400, "BAD_REQUEST");
  }

  const store = await getPageStore();
  const writeOpts = {
    origin: "manual" as const,
    message: body.message || `edit ${pagePath}`,
    author: tctx.user.email ?? AGENT_IDENTITIES.default,
  };
  // Whether this save changes a page or creates one, read before the write
  // since afterwards it always exists. Anything other than a clean "not
  // found" is treated as an edit: that is the common case, and a label is
  // not worth failing a save over.
  const existed = await store
    .readPage(tctx.projectId, pagePath)
    .then(() => true)
    .catch((error) => !(error instanceof PageNotFoundError));

  let written = false;
  if (body.base_revision_id !== undefined && !body.force) {
    if (body.base_revision_id !== null && typeof body.base_revision_id !== "string") {
      throw new ApiError("`base_revision_id` must be a string or null", 400, "BAD_REQUEST");
    }
    if (store.writePageIfCurrent) {
      const result = await store.writePageIfCurrent(
        tctx.projectId,
        pagePath,
        body.markdown,
        writeOpts,
        body.base_revision_id,
      );
      if (!result.written) {
        const latest = result.current;
        return NextResponse.json(
          {
            error: "This page changed after you started editing.",
            code: "PAGE_EDIT_CONFLICT",
            data: {
              current_revision_id: latest?._id ? String(latest._id) : null,
              current_markdown: latest?.markdown ?? "",
              current_author: latest?.author ?? null,
              current_created_at: latest?.created_at ?? null,
            },
          },
          { status: 409 },
        );
      }
      written = true;
    } else {
      const history = await store.pageHistory(tctx.projectId, pagePath);
      const latest = currentLiveRevision(history);
      const latestId = latest?._id ? String(latest._id) : null;
      if (hasPageEditConflict(history, body.base_revision_id)) {
        return NextResponse.json(
          {
            error: "This page changed after you started editing.",
            code: "PAGE_EDIT_CONFLICT",
            data: {
              current_revision_id: latestId,
              current_markdown: latest?.markdown ?? "",
              current_author: latest?.author ?? null,
              current_created_at: latest?.created_at ?? null,
            },
          },
          { status: 409 },
        );
      }
    }
  }
  if (!written) await store.writePage(tctx.projectId, pagePath, body.markdown, writeOpts);

  auditTome({
    action: "tome.page.edit",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    page: pagePath,
  });

  const page = toResponse(pagePath, body.markdown);
  // The page is already written; a notification problem must not turn a
  // successful save into a failed one.
  const notify = await notifyPageSaved({
    entitySlug: tctx.project.slug,
    entityTitle: tctx.project.title,
    teamSlug: tctx.project.team_slug,
    pagePath,
    pageTitle: page.title,
    editorName: tctx.user.email || "someone",
    existed,
    markdown: body.markdown,
    selection: parsePageNotifySelection(body.notify),
    excludeSubject: sessionSub(tctx.session) || undefined,
  }).catch((error) => {
    console.error("[tome] failed to notify about page save", error);
    return null;
  });

  return successResponse({ ...page, notify });
});

export const DELETE = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, path } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  await guardNotLocked(tctx.projectId, tctx.project.locked ?? false);
  const pagePath = pagePathFrom(path);

  const store = await getPageStore();
  await store.deletePage(tctx.projectId, pagePath, {
    author: tctx.user.email ?? AGENT_IDENTITIES.default,
    origin: "manual",
  });

  auditTome({
    action: "tome.page.delete",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    page: pagePath,
  });

  return successResponse({ deleted: true, path: pagePath });
});
