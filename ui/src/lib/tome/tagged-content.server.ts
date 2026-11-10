/**
 * The content tagged with a space, resolved for a particular reader.
 *
 * One resolution, two consumers: the Related content surface a reader sees,
 * and the knowledge a space's agent is given. Both must answer the same
 * question — "which pages, from anywhere, say they belong to this space?" —
 * and both must answer it only for spaces the caller may read, so the lookup
 * lives here rather than being written twice.
 *
 * Server-only.
 */

import { getCollection } from "@/lib/mongodb";
import { filterReadableTomeProjects } from "./access";
import { tomeSessionSubject } from "./data-steward";
import { getPageStore } from "./page-store";
import { pagesTaggingSpace, type TaggedPageRow } from "./space-tags-index";
import type { TomeProjectContext } from "./tome-api";
import type { ProjectDocument } from "@/types/projects";

/** One page tagged with this space, named so a reader can go read it in place. */
export interface TaggedContentItem {
  /** Where the page lives — never this space, which owns its own tree. */
  space_slug: string;
  /** The space's own name, so a row does not read as a bare slug. */
  space_title: string;
  path: string;
  title: string;
  /** How the page claims the space: whole page, passages, or both. */
  whole_page: boolean;
  passages: number;
  updated_at: string;
}

/**
 * Keep only the rows whose home space this caller may read.
 *
 * A tag is written in someone else's space, so the reader standing in the
 * tagged space has no authorization over it. Listing a page they cannot open
 * would leak both its title and the fact that the two spaces are connected.
 */
async function readableRows(
  ctx: TomeProjectContext,
  rows: TaggedPageRow[],
): Promise<Map<string, ProjectDocument>> {
  const slugs = [...new Set(rows.map((row) => row.spaceSlug))];
  if (slugs.length === 0) return new Map();
  const projects = await getCollection<ProjectDocument>("projects");
  const found = await projects
    .find({ slug: { $in: slugs } }, { projection: { slug: 1, title: 1, name: 1, type: 1 } })
    .toArray();
  const readable = await filterReadableTomeProjects(
    tomeSessionSubject(ctx.session),
    found,
    { isAdmin: ctx.canManageSteward },
  );
  return new Map(readable.map((project) => [project.slug, project]));
}

/**
 * The pages tagged with this space, newest first.
 *
 * One row per page, however many passages inside it carry the tag: the page
 * is the thing a reader opens, and a second row for the same page would say
 * the same thing twice.
 */
export async function taggedContentForSpace(
  ctx: TomeProjectContext,
): Promise<TaggedContentItem[]> {
  const rows = await pagesTaggingSpace(ctx.project.slug);
  const spaces = await readableRows(ctx, rows);
  return rows.flatMap((row) => {
    const space = spaces.get(row.spaceSlug);
    if (!space) return [];
    return [
      {
        space_slug: row.spaceSlug,
        space_title: space.title || space.name || row.spaceSlug,
        path: row.path,
        title: row.title,
        whole_page: row.count.page,
        passages: row.count.passages,
        updated_at: row.updatedAt,
      },
    ];
  });
}

/** A tagged page with its body, as the agent would need to read it. */
export interface TaggedKnowledgePage extends TaggedContentItem {
  markdown: string;
}

/**
 * The tagged pages with their bodies, for a space's agent.
 *
 * Capped, because this rides inside one request body alongside the rest of
 * the snapshot: a space that a hundred pages have tagged would otherwise push
 * the prompt past anything the model can read.
 */
export async function taggedKnowledgeForSpace(
  ctx: TomeProjectContext,
  limit = 20,
): Promise<TaggedKnowledgePage[]> {
  const items = (await taggedContentForSpace(ctx)).slice(0, limit);
  if (items.length === 0) return [];
  const store = await getPageStore();
  const projects = await getCollection<ProjectDocument>("projects");
  const ids = new Map<string, string>();
  for (const project of await projects
    .find({ slug: { $in: [...new Set(items.map((item) => item.space_slug))] } }, { projection: { slug: 1 } })
    .toArray()) {
    ids.set(project.slug, String(project._id));
  }
  const pages = await Promise.all(
    items.map(async (item) => {
      const projectId = ids.get(item.space_slug);
      if (!projectId) return null;
      // A stale index row or a deleted page drops out rather than failing the
      // whole turn: tagged content is supplementary context, not the request.
      const markdown = await store.readPage(projectId, item.path).catch(() => null);
      return markdown === null ? null : { ...item, markdown };
    }),
  );
  return pages.filter((page): page is TaggedKnowledgePage => page !== null);
}
