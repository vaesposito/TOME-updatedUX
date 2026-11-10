/**
 * What sits above a space, as one path.
 *
 * TOME arranges spaces two ways, and a trail up one is not a trail up the
 * other:
 *
 *   hierarchy axis   BHAG     → Area     → Project
 *   function axis    Function → Category → Subject
 *
 * Which axis applies is `placementOf`'s answer, not a second judgement made
 * here, so a trail can never climb an arrangement the space is not listed
 * under. A subject therefore names its Function and Category and never a
 * BHAG, even where the record still carries one from an earlier life.
 *
 * Read by both surfaces that draw the trail — the breadcrumb at the top of a
 * space and Home's "Part of" card — so the two cannot disagree about where a
 * space sits.
 *
 * Pure: resolved ancestors and a taxonomy go in, rows come out.
 */

import {
  categorySlug,
  type FunctionTaxonomy,
} from "@/lib/projects/function-taxonomy";
import { normLabel } from "@/lib/projects/labels";
import { placementOf } from "@/lib/projects/placement";
import type { ProjectLabels } from "@/types/projects";

/** One step up the trail, furthest ancestor first. */
export interface AncestorRow {
  /** Where the ancestor is, already built: the two axes do not route alike. */
  href: string;
  title: string;
  type: "bhag" | "area" | "function" | "category";
}

/** A wiki space standing above another one. */
export interface TrailSpace {
  slug: string;
  name?: string;
  title?: string;
}

/** Where the function axis is browsed from. */
export const FUNCTIONS_HREF = "/projects?tab=functions";

export function spaceTrail({
  labels,
  taxonomy,
  bhag,
  area,
}: {
  labels: ProjectLabels | undefined;
  taxonomy: FunctionTaxonomy;
  /** The hierarchy ancestors, already looked up. Ignored for a subject. */
  bhag?: TrailSpace;
  area?: TrailSpace;
}): AncestorRow[] {
  const placement = placementOf(labels);

  if (placement.axis === "function") {
    const rows: AncestorRow[] = [
      { href: FUNCTIONS_HREF, title: placement.function, type: "function" },
    ];
    if (placement.category) {
      // A category is a division of one function's work, so it is only
      // reachable once both are known by id. Falls back to the function list
      // when this device's taxonomy has not heard of the pair, rather than
      // linking somewhere there is nothing to see.
      rows.push({
        href:
          categoryHref(taxonomy, placement.function, placement.category) ??
          FUNCTIONS_HREF,
        title: placement.category,
        type: "category",
      });
    }
    return rows;
  }

  const rows: AncestorRow[] = [];
  if (bhag) rows.push(spaceRow(bhag, "bhag"));
  if (area) rows.push(spaceRow(area, "area"));
  return rows;
}

function spaceRow(space: TrailSpace, type: "bhag" | "area"): AncestorRow {
  return {
    href: `/projects/${space.slug}/tome`,
    title: space.title ?? space.name ?? space.slug,
    type,
  };
}

/**
 * Where a function's category is, by the names a subject carries.
 *
 * A subject names its function and category in words; the route wants both
 * ids, and an id is not derivable from a name — the taxonomy suffixes one
 * that collides. So the names are matched back against the taxonomy rather
 * than slugified afresh.
 */
function categoryHref(
  taxonomy: FunctionTaxonomy,
  functionName: string,
  categoryName: string,
): string | undefined {
  const fn = taxonomy.functions.find(
    (candidate) => normLabel(candidate.name) === normLabel(functionName),
  );
  const category = fn?.categories.find(
    (candidate) => normLabel(candidate.name) === normLabel(categoryName),
  );
  if (!fn || !category) return undefined;
  return `/projects/functions/${categorySlug(fn, category)}`;
}
