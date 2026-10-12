/**
 * Walking the BHAG → Area → Project hierarchy.
 *
 * The three tiers are all rows in `projects`, linked by label tags rather than
 * by a parent pointer: an Area names its BHAG in `labels.initiatives`, and a
 * Project names its Area in `labels.areas` (or skips a tier and names the
 * BHAG directly). These helpers turn that into the two shapes callers need —
 * everything below an entity, and the chain above a set of entities.
 *
 * Server-only.
 */

import { getCollection } from "@/lib/mongodb";
import { filterReadableTomeProjects } from "@/lib/tome/access";
import { resolveAreaChildren, resolveBhagChildren } from "@/lib/tome/bhag";
import type { ProjectDocument, ProjectType } from "@/types/projects";

export interface EntityNode {
  slug: string;
  title: string;
  type: ProjectType;
  /** The tier above, when there is one. */
  parent_slug?: string;
}

/** Depth in the hierarchy, used to indent a flattened list. */
export const ENTITY_DEPTH: Record<ProjectType, number> = {
  bhag: 0,
  area: 1,
  project: 2,
};

/**
 * The entity plus everything beneath it.
 *
 * A BHAG and an Area rarely carry notifications of their own — the work
 * happens in the Projects below them — so anything that filters or digests by
 * entity has to include the subtree or it will come back empty.
 */
export async function resolveEntitySubtree(
  entity: Pick<ProjectDocument, "slug" | "title" | "type">,
): Promise<EntityNode[]> {
  const self: EntityNode = {
    slug: entity.slug,
    title: entity.title,
    type: entity.type ?? "project",
  };
  if (self.type === "project") return [self];

  if (self.type === "area") {
    const children = await resolveAreaChildren(self.slug);
    return [
      self,
      ...children.map((child) => ({
        slug: child.slug,
        title: child.name,
        type: "project" as ProjectType,
        parent_slug: self.slug,
      })),
    ];
  }

  const children = await resolveBhagChildren(self.slug);
  const grandchildren = await Promise.all(
    children
      .filter((child) => child.type === "area")
      .map(async (child) => ({
        area: child.slug,
        projects: await resolveAreaChildren(child.slug),
      })),
  );

  const seen = new Set([self.slug]);
  const subtree: EntityNode[] = [self];
  for (const child of children) {
    if (seen.has(child.slug)) continue;
    seen.add(child.slug);
    subtree.push({
      slug: child.slug,
      title: child.name,
      type: child.type,
      parent_slug: self.slug,
    });
  }
  for (const { area, projects } of grandchildren) {
    for (const project of projects) {
      if (seen.has(project.slug)) continue;
      seen.add(project.slug);
      subtree.push({
        slug: project.slug,
        title: project.name,
        type: "project",
        parent_slug: area,
      });
    }
  }
  return subtree;
}

/**
 * Depth-first order: each BHAG, then its Areas, then their Projects, sorted
 * by title within a tier. Callers render the list flat and indent by type, so
 * the order has to carry the shape.
 */
export function sortHierarchy(nodes: readonly EntityNode[]): EntityNode[] {
  const children = new Map<string, EntityNode[]>();
  const roots: EntityNode[] = [];
  for (const node of nodes) {
    if (node.parent_slug) {
      children.set(node.parent_slug, [
        ...(children.get(node.parent_slug) ?? []),
        node,
      ]);
    } else {
      roots.push(node);
    }
  }

  const byTitle = (a: EntityNode, b: EntityNode) => a.title.localeCompare(b.title);
  const ordered: EntityNode[] = [];
  const seen = new Set<string>();
  const walk = (node: EntityNode) => {
    // A label tag can in principle point back up the tree; without this the
    // walk would recurse forever on a mis-tagged entity.
    if (seen.has(node.slug)) return;
    seen.add(node.slug);
    ordered.push(node);
    for (const child of (children.get(node.slug) ?? []).sort(byTitle)) {
      walk(child);
    }
  };
  for (const root of roots.sort(byTitle)) walk(root);

  // Anything left is in a cycle or hangs off a parent that vanished mid-read;
  // listing it at the end beats dropping it silently.
  for (const node of nodes) if (!seen.has(node.slug)) ordered.push(node);
  return ordered;
}

/**
 * Every BHAG, Area and Project the caller may read, in depth-first order.
 *
 * Unlike `resolveEntitySubtree` this starts from the whole catalogue, because
 * the follow tree is where someone chooses what to watch: entities they have
 * never opened are exactly the ones they need to be offered.
 */
export async function resolveReadableHierarchy(
  subject: string,
  options: { isAdmin?: boolean } = {},
): Promise<EntityNode[]> {
  const collection = await getCollection<ProjectDocument>("projects");
  const rows = await collection
    .find({})
    .project<ProjectDocument>({ slug: 1, title: 1, name: 1, type: 1, labels: 1 })
    .toArray();

  const readable = await filterReadableTomeProjects(subject, rows, options);
  const present = new Set(readable.map((row) => row.slug));

  return sortHierarchy(
    readable.map((row) => {
      const parent = parentOf(row);
      return {
        slug: row.slug,
        title: row.title || row.name || row.slug,
        type: row.type ?? "project",
        // A parent the reader cannot see would leave the child dangling under
        // nothing, so it is promoted to a root rather than hidden.
        ...(parent && present.has(parent) ? { parent_slug: parent } : {}),
      };
    }),
  );
}

/** A project's parent is its Area, or its BHAG when it skips the Area tier. */
function parentOf(project: Pick<ProjectDocument, "type" | "labels">): string | undefined {
  const areas = project.labels?.areas ?? [];
  const initiatives = project.labels?.initiatives ?? [];
  if ((project.type ?? "project") === "area") return initiatives[0] || undefined;
  return areas[0] || initiatives[0] || undefined;
}

/**
 * The given entities plus every ancestor above them.
 *
 * Notifications are raised against Projects, so a sidebar that wants to offer
 * "this whole BHAG" has to discover the BHAG from its children — it will
 * never appear in the notification rows itself.
 */
export async function resolveEntityAncestry(
  slugs: readonly string[],
): Promise<Map<string, EntityNode>> {
  const found = new Map<string, EntityNode>();
  const projects = await getCollection<ProjectDocument>("projects");
  let frontier = [...new Set(slugs.filter(Boolean))];

  // Three tiers at most, so this terminates well before the guard; the bound
  // is here so a cyclic label tag cannot spin forever.
  for (let depth = 0; depth < 4 && frontier.length > 0; depth += 1) {
    const rows = await projects
      .find({ slug: { $in: frontier } })
      .project<Pick<ProjectDocument, "slug" | "title" | "type" | "labels">>({
        slug: 1,
        title: 1,
        type: 1,
        labels: 1,
      })
      .toArray();

    const next: string[] = [];
    for (const row of rows) {
      if (found.has(row.slug)) continue;
      const parent = parentOf(row);
      found.set(row.slug, {
        slug: row.slug,
        title: row.title || row.slug,
        type: row.type ?? "project",
        ...(parent ? { parent_slug: parent } : {}),
      });
      if (parent && !found.has(parent)) next.push(parent);
    }
    frontier = [...new Set(next)];
  }
  return found;
}
