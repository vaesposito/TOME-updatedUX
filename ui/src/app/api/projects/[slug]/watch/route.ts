import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { getTomeProjectPermissions } from "@/lib/tome/data-steward";
import { safePagePath } from "@/lib/tome/page-store";
import { resolveUniqueTomeProjectBySlug } from "@/lib/tome/project-resolver";
import { requireInteractiveTomePrincipal } from "@/lib/tome/principal";
import {
  getEntityWatchState,
  unwatchEntity,
  watchEntity,
} from "@/lib/tome/watchers";
import type { ProjectDocument } from "@/types/projects";

/**
 * Resolve the entity and the caller, failing closed unless the caller can
 * already read it. Watching must never become a way to observe an entity that
 * is not shared with you.
 */
async function requireReadableEntity(request: NextRequest, slug: string): Promise<{
  project: ProjectDocument;
  subject: string;
  email?: string;
}> {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }

  const { user, session } = await getAuthFromBearerOrSession(request);
  requireInteractiveTomePrincipal(session);

  const project = await resolveUniqueTomeProjectBySlug(slug);
  if (!project) {
    throw new ApiError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  const permissions = await getTomeProjectPermissions({ project, user, session });
  if (!permissions.canRead) {
    throw new ApiError(
      "This Tome entity is not shared with one of your teams",
      403,
      "TOME_READ_REQUIRED",
    );
  }

  const subject = typeof session.sub === "string" ? session.sub.trim() : "";
  if (!subject) {
    throw new ApiError(
      "Your session has expired. Please sign in again.",
      401,
      "NO_TOKEN",
    );
  }

  return { project, subject, email: user.email ?? undefined };
}

/**
 * `?page=` narrows the subscription to one wiki page inside the entity.
 *
 * The path is pushed through the same validator the page routes use, so a
 * traversal attempt cannot be stored as a subscription and later echoed back
 * into a link. An absent or blank parameter means the whole entity.
 */
function pageParam(request: NextRequest): string | undefined {
  const raw = new URL(request.url).searchParams.get("page")?.trim();
  if (!raw) return undefined;
  try {
    return safePagePath(raw);
  } catch {
    throw new ApiError("Invalid page path", 400, "INVALID_PAGE_PATH");
  }
}

export const GET = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ slug: string }> }) => {
    const { slug } = await context.params;
    const { project, subject } = await requireReadableEntity(request, slug);
    return successResponse(
      await getEntityWatchState(project.slug, subject, pageParam(request)),
    );
  },
);

export const POST = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ slug: string }> }) => {
    const { slug } = await context.params;
    const { project, subject, email } = await requireReadableEntity(request, slug);
    const pagePath = pageParam(request);
    await watchEntity({
      entitySlug: project.slug,
      entityType: project.type ?? "project",
      subject,
      email,
      ...(pagePath ? { pagePath } : {}),
    });
    return successResponse(
      await getEntityWatchState(project.slug, subject, pagePath),
    );
  },
);

export const DELETE = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ slug: string }> }) => {
    const { slug } = await context.params;
    const { project, subject } = await requireReadableEntity(request, slug);
    const pagePath = pageParam(request);
    await unwatchEntity(project.slug, subject, pagePath);
    return successResponse(
      await getEntityWatchState(project.slug, subject, pagePath),
    );
  },
);
