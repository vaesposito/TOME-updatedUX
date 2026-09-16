/**
 * PageStore backend: page bodies inlined in Mongo.
 *
 * Append-only `tome_page_revisions`: each write inserts a row; the current
 * live body for a path is the latest non-tombstone, non-draft revision by
 * (created_at, _id). The agent's `/project` working copy is rehydrated from
 * this store over the tome API rather than mirrored on disk.
 */

import { ObjectId, type Filter } from "mongodb";

import { AGENT_IDENTITIES } from "./agent-identities";
import {
  getTomePageRevisionsCollection,
  getTomePageWriteLocksCollection,
} from "./mongo-collections";
import { currentLiveRevision, hasPageEditConflict } from "./revision-conflict";
import {
  safePagePath,
  type ConditionalPageWriteResult,
  type PageStore,
  type WritePageOpts,
} from "./page-store";
import { FM_TEMPLATE_PATH, FM_TEMPLATE_SCOPE, FM_TEMPLATE_VERSION, parseFrontmatter } from "./schema";
import type { PageRevision } from "@/types/tome";

const DEFAULT_AUTHOR = AGENT_IDENTITIES.default;
const PAGE_WRITE_LOCK_TTL_MS = 30_000;
const PAGE_WRITE_LOCK_ATTEMPTS = 40;
const PAGE_WRITE_LOCK_RETRY_MS = 25;

async function withPageWriteLock<T>(
  projectId: string,
  path: string,
  work: () => Promise<T>,
): Promise<T> {
  const locks = await getTomePageWriteLocksCollection();
  const lockId = `${projectId}:${safePagePath(path)}`;
  const ownerToken = new ObjectId().toHexString();
  let acquired = false;

  for (let attempt = 0; attempt < PAGE_WRITE_LOCK_ATTEMPTS; attempt += 1) {
    const now = new Date();
    try {
      const lock = await locks.findOneAndUpdate(
        { _id: lockId, expires_at: { $lte: now } },
        {
          $set: {
            owner_token: ownerToken,
            expires_at: new Date(now.getTime() + PAGE_WRITE_LOCK_TTL_MS),
          },
        },
        { upsert: true, returnDocument: "after" },
      );
      if (lock?.owner_token === ownerToken) {
        acquired = true;
        break;
      }
    } catch (error: unknown) {
      // Two callers racing to create a lock document: the loser retries after
      // observing the winner's lease on the next iteration.
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, PAGE_WRITE_LOCK_RETRY_MS));
  }

  if (!acquired) {
    throw new Error(`Timed out acquiring page write lock for ${path}`);
  }

  try {
    return await work();
  } finally {
    await locks.deleteOne({ _id: lockId, owner_token: ownerToken });
  }
}

function templateMetadata(markdown: string): Pick<
  PageRevision,
  "template_scope" | "template_path" | "template_version"
> {
  const [frontmatter] = parseFrontmatter(markdown);
  const scope = frontmatter[FM_TEMPLATE_SCOPE];
  const path = frontmatter[FM_TEMPLATE_PATH];
  const version = frontmatter[FM_TEMPLATE_VERSION];
  return {
    ...(scope === null || scope === "null"
      ? { template_scope: null }
      : typeof scope === "string"
        ? { template_scope: scope }
        : {}),
    ...(path === null || path === "null"
      ? { template_path: null }
      : typeof path === "string"
        ? { template_path: path }
        : {}),
    ...(typeof version === "number" ? { template_version: version } : {}),
  };
}

export class MongoPageStore implements PageStore {
  async writePageIfCurrent(
    projectId: string,
    path: string,
    markdown: string,
    opts: WritePageOpts,
    baseRevisionId: string | null,
  ): Promise<ConditionalPageWriteResult> {
    return withPageWriteLock(projectId, path, async () => {
      const history = await this.pageHistory(projectId, path);
      const current = currentLiveRevision(history);
      if (hasPageEditConflict(history, baseRevisionId)) {
        return { written: false, current };
      }

      await this.writePage(projectId, path, markdown, opts);
      return { written: true };
    });
  }

  async writePage(
    projectId: string,
    path: string,
    markdown: string,
    opts: WritePageOpts,
  ): Promise<void> {
    await this.writePages(projectId, { [path]: markdown }, opts);
  }

  async writePages(
    projectId: string,
    pages: Record<string, string>,
    opts: WritePageOpts,
  ): Promise<void> {
    const entries = Object.entries(pages);
    if (entries.length === 0) return;
    const now = new Date();
    const rows: PageRevision[] = entries.map(([path, md]) => ({
      project_id: projectId,
      path: safePagePath(path),
      markdown: md,
      author: opts.author ?? DEFAULT_AUTHOR,
      message: opts.message,
      created_at: now,
      ...templateMetadata(md),
      ...(opts.reportId ? { report_id: opts.reportId } : {}),
      ...(opts.origin ? { origin: opts.origin } : {}),
      ...(opts.status === "draft" ? { status: "draft" as const } : {}),
    }));
    const col = await getTomePageRevisionsCollection();
    await col.insertMany(rows);
  }

  async readPage(
    projectId: string,
    path: string,
    opts: { includeDrafts?: boolean } = {},
  ): Promise<string> {
    const safe = safePagePath(path);
    const col = await getTomePageRevisionsCollection();
    const excluded = opts.includeDrafts ? ["rejected" as const] : ["draft" as const, "rejected" as const];
    const filter: Filter<PageRevision> = {
      project_id: projectId,
      path: safe,
      status: { $nin: excluded },
    };
    const rev = await col.findOne(filter, { sort: { created_at: -1, _id: -1 } });
    if (!rev || rev.deleted) {
      throw new PageNotFoundError(path);
    }
    return rev.markdown ?? "";
  }

  async listPages(
    projectId: string,
    opts: { includeDrafts?: boolean } = {},
  ): Promise<Record<string, string>> {
    const col = await getTomePageRevisionsCollection();
    const excluded = opts.includeDrafts ? ["rejected" as const] : ["draft" as const, "rejected" as const];
    const filter: Filter<PageRevision> = { project_id: projectId, status: { $nin: excluded } };
    // Newest-first; first row seen per path wins (tombstone or body).
    const rows = await col
      .find(filter)
      .sort({ path: 1, created_at: -1, _id: -1 })
      .toArray();
    const out: Record<string, string> = {};
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.path)) continue;
      seen.add(r.path);
      if (!r.deleted) out[r.path] = r.markdown ?? "";
    }
    return out;
  }

  async deletePage(
    projectId: string,
    path: string,
    opts: { author?: string; message?: string; origin?: PageRevision["origin"] } = {},
  ): Promise<void> {
    const safe = safePagePath(path);
    const col = await getTomePageRevisionsCollection();
    await col.insertOne({
      project_id: projectId,
      path: safe,
      markdown: "",
      author: opts.author ?? DEFAULT_AUTHOR,
      message: opts.message || `deleted ${safe}`,
      deleted: true,
      created_at: new Date(),
      ...(opts.origin ? { origin: opts.origin } : {}),
    });
  }

  async pageHistory(projectId: string, path: string): Promise<PageRevision[]> {
    const safe = safePagePath(path);
    const col = await getTomePageRevisionsCollection();
    return col
      .find({ project_id: projectId, path: safe })
      .sort({ created_at: -1, _id: -1 })
      .toArray();
  }

  async readRevision(
    projectId: string,
    revisionId: string,
  ): Promise<PageRevision | null> {
    const col = await getTomePageRevisionsCollection();
    // Revisions are stored with auto ObjectId ids; accept the hex string.
    const idFilter = ObjectId.isValid(revisionId)
      ? (new ObjectId(revisionId) as unknown as string)
      : revisionId;
    return col.findOne({ _id: idFilter, project_id: projectId });
  }

  async promoteDraftReport(projectId: string, reportId: string): Promise<void> {
    const col = await getTomePageRevisionsCollection();
    await col.updateMany(
      { project_id: projectId, report_id: reportId, status: "draft" },
      { $unset: { status: "" } },
    );
  }

  async rejectDraftReport(projectId: string, reportId: string): Promise<void> {
    const col = await getTomePageRevisionsCollection();
    // Draft rows are already excluded from live reads. Re-stamp them
    // "rejected" (rather than deleting) so they stop showing as pending
    // review while staying in history; the prior live revision (if any)
    // is unaffected and remains current.
    await col.updateMany(
      { project_id: projectId, report_id: reportId, status: "draft" },
      { $set: { status: "rejected" } },
    );
  }

  async resolveOrphanDraft(
    projectId: string,
    revisionId: string,
    resolution: "publish" | "reject",
    reviewedBy: string,
  ): Promise<PageRevision | null> {
    const col = await getTomePageRevisionsCollection();
    const idFilter = ObjectId.isValid(revisionId)
      ? (new ObjectId(revisionId) as unknown as string)
      : revisionId;
    const now = new Date();

    // Publishing restamps the revision as the newest live write while retaining
    // its original timestamp. The content remains unchanged, and the status
    // transition is atomic so two reviewers cannot resolve the same draft.
    const update = resolution === "publish"
      ? [{
          $set: {
            status: "live",
            draft_created_at: "$created_at",
            created_at: now,
            reviewed_at: now,
            reviewed_by: reviewedBy,
            review_outcome: "published",
          },
        }]
      : [{
          $set: {
            status: "rejected",
            reviewed_at: now,
            reviewed_by: reviewedBy,
            review_outcome: "rejected",
          },
        }];

    return col.findOneAndUpdate(
      {
        _id: idFilter,
        project_id: projectId,
        status: "draft",
        $or: [{ report_id: { $exists: false } }, { report_id: null }],
      },
      update,
      { returnDocument: "after" },
    );
  }

  async listDraftPaths(projectId: string, reportId: string): Promise<string[]> {
    const col = await getTomePageRevisionsCollection();
    const rows = await col
      .find(
        { project_id: projectId, report_id: reportId, status: "draft" },
        { projection: { path: 1 } },
      )
      .toArray();
    return [...new Set(rows.map((r) => r.path))];
  }

  async listTouchedPaths(projectId: string, reportId: string): Promise<string[]> {
    const col = await getTomePageRevisionsCollection();
    const rows = await col
      .find({ project_id: projectId, report_id: reportId }, { projection: { path: 1 } })
      .toArray();
    return [...new Set(rows.map((r) => r.path))];
  }

  async revertPage(
    projectId: string,
    path: string,
    revisionId: string,
    opts: { author?: string; message?: string; origin?: PageRevision["origin"] } = {},
  ): Promise<void> {
    const target = await this.readRevision(projectId, revisionId);
    if (!target || target.path !== safePagePath(path)) {
      throw new PageNotFoundError(path);
    }
    const col = await getTomePageRevisionsCollection();
    await col.insertOne({
      project_id: projectId,
      path: target.path,
      markdown: target.deleted ? "" : target.markdown ?? "",
      deleted: target.deleted,
      author: opts.author ?? DEFAULT_AUTHOR,
      message: opts.message || `reverted to a previous revision`,
      reverted_from: revisionId,
      created_at: new Date(),
      ...templateMetadata(target.markdown ?? ""),
      ...(opts.origin ? { origin: opts.origin } : {}),
    });
  }
}

/** Thrown by readPage when a path is missing or tombstoned. */
export class PageNotFoundError extends Error {
  constructor(path: string) {
    super(`page not found: ${path}`);
    this.name = "PageNotFoundError";
  }
}
