/**
 * Index of which pages are tagged with which space.
 *
 * A tag is written into the tagged content's OWN page, in whatever space that
 * page lives in — there is no copy of it in the space being tagged. This index
 * is what lets the tagged side see it anyway: every page write is mirrored
 * into `tome_space_tags_index`, keyed by the slugs it tags, so
 * `pagesTaggingSpace(slug)` answers "what names me" with one query instead of
 * scanning every other space's pages.
 *
 * Same mechanism and the same choke point as the edge backlink index (see
 * `./edges-index.ts` and `getPageStore` in `./page-store.ts`), so a tag stays
 * indexed regardless of who wrote the page — a person in the wiki editor, the
 * ingest agent, or chat — and regardless of the active PageStore backend.
 *
 * Server-only.
 */

import { getTomeSpaceTagsIndexCollection } from "./mongo-collections";
import { pageSpaceTags, type SpaceTagCount } from "./space-tags";
import { FM_TITLE, parseFrontmatter } from "./schema";
import { pageDisplayName } from "./page-names";
import type { SpaceTagIndexRow } from "@/types/tome";

function rowId(projectId: string, path: string): string {
  return `${projectId}:${path}`;
}

/** The page's own name, as the related-content row will read it. */
function titleOf(path: string, markdown: string): string {
  const [fm] = parseFrontmatter(markdown);
  const title = String(fm[FM_TITLE] ?? "").trim();
  return title || pageDisplayName(path);
}

/**
 * Re-derive the index row for one page write, or remove it when the page was
 * deleted or no longer tags anything.
 */
export async function syncSpaceTagIndex(
  projectId: string,
  projectSlug: string,
  path: string,
  markdown: string | null,
): Promise<void> {
  const col = await getTomeSpaceTagsIndexCollection();
  const _id = rowId(projectId, path);

  if (markdown === null) {
    await col.deleteOne({ _id });
    return;
  }

  const tags = pageSpaceTags(markdown);
  // A page that tags nothing keeps no row. Untagging is therefore a delete,
  // which is what makes the index shrink when a tag is removed rather than
  // leaving a stale row claiming the page still names the space.
  if (tags.slugs.length === 0) {
    await col.deleteOne({ _id });
    return;
  }

  const row: SpaceTagIndexRow = {
    _id,
    project_id: projectId,
    project_slug: projectSlug,
    path,
    title: titleOf(path, markdown),
    tagged_slugs: tags.slugs,
    counts: tags.bySlug,
    updated_at: new Date(),
  };
  await col.replaceOne({ _id }, row, { upsert: true });
}

/** One page that tags a space, named so a reader can go and read it in place. */
export interface TaggedPageRow {
  /** The space the page lives in. */
  spaceSlug: string;
  path: string;
  title: string;
  count: SpaceTagCount;
  updatedAt: string;
}

/**
 * The pages tagged with `slug`, newest first — one row per page, however many
 * passages inside it carry the tag.
 *
 * Pages in the space's own wiki are excluded: they are already in front of the
 * reader in the tree, and "related content" promises what is *elsewhere*.
 */
export async function pagesTaggingSpace(slug: string): Promise<TaggedPageRow[]> {
  const col = await getTomeSpaceTagsIndexCollection();
  const rows = await col
    .find({ tagged_slugs: slug, project_slug: { $ne: slug } })
    .sort({ updated_at: -1 })
    .toArray();
  return rows.map((row) => ({
    spaceSlug: row.project_slug,
    path: row.path,
    title: row.title,
    count: row.counts?.[slug] ?? { page: true, passages: 0 },
    updatedAt: (row.updated_at instanceof Date
      ? row.updated_at
      : new Date(row.updated_at)
    ).toISOString(),
  }));
}

/** Drop every index row for a project, used when the space itself goes away. */
export async function clearSpaceTagIndexFor(projectId: string): Promise<void> {
  const col = await getTomeSpaceTagsIndexCollection();
  await col.deleteMany({ project_id: projectId });
}
