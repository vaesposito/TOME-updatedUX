// The inbox's "Following" tab: GET the readable BHAG → Area → Project tree
// with watch state and unread counts, POST to follow or unfollow a set of
// entities in one go (checking a BHAG means checking everything under it, and
// that should be one request rather than thirty).

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { getNotificationFollowTree } from "@/lib/notification-inbox.server";
import {
  filterReadableTomeProjects,
  isTomeAdminSubject,
} from "@/lib/tome/access";
import { safePagePath } from "@/lib/tome/page-store";
import { unwatchEntity, watchEntity } from "@/lib/tome/watchers";
import type { ProjectDocument } from "@/types/projects";

export const dynamic = "force-dynamic";

async function requireSubject(request: NextRequest) {
  const { user, session } = await getAuthFromBearerOrSession(request);
  const subject = typeof session.sub === "string" ? session.sub.trim() : "";
  if (!subject) {
    throw new ApiError("Authentication required", 401, "NO_TOKEN");
  }
  return { subject, email: user.email ?? "" };
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { subject, email } = await requireSubject(request);
  return successResponse(
    await getNotificationFollowTree({
      subject,
      email,
      isAdmin: await isTomeAdminSubject(subject),
    }),
  );
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { subject, email } = await requireSubject(request);
  const body = (await request.json().catch(() => null)) as {
    slugs?: unknown;
    following?: unknown;
  } | null;

  const requested = Array.isArray(body?.slugs)
    ? [...new Set(body.slugs.filter((slug): slug is string => typeof slug === "string" && slug.length > 0))]
    : [];
  if (requested.length === 0) {
    throw new ApiError("No entities given", 400, "NO_ENTITIES");
  }
  const following = body?.following === true;

  // The tree addresses a page as `<entity-slug>#<page-path>`; everything else
  // is an entity. Both resolve to the same entity for the permission check.
  const targets = requested.map((slug) => {
    const hash = slug.indexOf("#");
    return hash === -1
      ? { entitySlug: slug, pagePath: undefined as string | undefined }
      : { entitySlug: slug.slice(0, hash), pagePath: slug.slice(hash + 1) };
  });

  // Re-check every slug against the caller's own read permission. The client
  // sends whatever subtree it drew, and watching an entity makes its activity
  // flow into an inbox — so an unreadable slug must not slip through.
  const catalog = await getCollection<ProjectDocument>("projects");
  const rows = await catalog
    .find({ slug: { $in: [...new Set(targets.map((t) => t.entitySlug))] } })
    .toArray();
  const allowed = await filterReadableTomeProjects(subject, rows, {
    isAdmin: await isTomeAdminSubject(subject),
  });
  const bySlug = new Map(allowed.map((project) => [project.slug, project]));

  for (const target of targets) {
    const project = bySlug.get(target.entitySlug);
    if (!project) continue;
    // A malformed page path is dropped rather than failing the whole batch:
    // ticking a BHAG should not be refused because one stale row is bad.
    let pagePath: string | undefined;
    if (target.pagePath) {
      try {
        pagePath = safePagePath(target.pagePath);
      } catch {
        continue;
      }
    }
    if (following) {
      await watchEntity({
        entitySlug: project.slug,
        entityType: project.type ?? "project",
        subject,
        email: email || undefined,
        ...(pagePath ? { pagePath } : {}),
      });
    } else {
      await unwatchEntity(project.slug, subject, pagePath);
    }
  }

  return successResponse(
    await getNotificationFollowTree({
      subject,
      email,
      isAdmin: await isTomeAdminSubject(subject),
    }),
  );
});
