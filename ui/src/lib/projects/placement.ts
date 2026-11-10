/**
 * Which of the two axes a space sits on, and what sits above it there.
 *
 * TOME organises spaces two ways, and they are not two readings of one set:
 *
 *   hierarchy axis   BHAG     → Area     → Project
 *   function axis    Function → Category → Subject
 *
 * A Project and a Subject are different entities. A record is on exactly one
 * axis, so the catalogue and the function view show disjoint sets and opening
 * a subject can never land on a project. The only thing that crosses between
 * them is content: a page tagged with a project surfaces in that project's
 * related items, whichever axis the page's own space is on.
 *
 * Pure: no React, no storage, no fetch. The rule lives here so every surface
 * reads it the same way instead of each deriving its own.
 */

import { normLabel } from "@/lib/projects/labels";
import type { ProjectLabels } from "@/types/projects";

export type SpaceAxis = "hierarchy" | "function";

/** A space on the function axis, and the function and category above it. */
export interface SubjectPlacement {
  axis: "function";
  /** The part of the organisation that owns the subject. */
  function: string;
  /** The division of that function's work, when the subject names one. */
  category?: string;
}

/** A space on the hierarchy axis, and the BHAG and area above it. */
export interface HierarchyPlacement {
  axis: "hierarchy";
  initiative?: string;
  area?: string;
}

export type Placement = SubjectPlacement | HierarchyPlacement;

/** The little of a space this module needs: where it says it belongs. */
export interface PlaceableSpace {
  labels?: ProjectLabels;
}

/**
 * Where a space belongs.
 *
 * Naming a function is decisive: a record that names one is a subject even if
 * it also carries a BHAG or an area. A space cannot be in two places, and
 * `labels.functions` is the deliberate claim of the two — it is only ever set
 * by someone putting the space on the function axis, whereas `initiatives`
 * and `areas` are the catalogue's default placement and are easily carried
 * over from an earlier life of the record. Keying on one field also means the
 * answer can be read off a record alone, so no two surfaces can disagree
 * about where a space lives.
 *
 * Only the first value of each level is read: an axis is a single path, and a
 * space with two functions is still in one place.
 */
export function placementOf(labels: ProjectLabels | undefined): Placement {
  const fn = first(labels?.functions);
  if (fn) {
    const category = first(labels?.categories);
    return { axis: "function", function: fn, ...(category ? { category } : {}) };
  }
  const initiative = first(labels?.initiatives);
  const area = first(labels?.areas);
  return {
    axis: "hierarchy",
    ...(initiative ? { initiative } : {}),
    ...(area ? { area } : {}),
  };
}

function first(values: readonly string[] | undefined): string | undefined {
  for (const value of values ?? []) {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/** True of a space on the function axis — a subject, never a project. */
export function isSubject(space: PlaceableSpace): boolean {
  return placementOf(space.labels).axis === "function";
}

/** True of a space on the hierarchy axis — a BHAG, an area or a project. */
export function isHierarchySpace(space: PlaceableSpace): boolean {
  return !isSubject(space);
}

/**
 * The two axes as two lists.
 *
 * One pass, so the two tabs are partitioned by a single reading rather than
 * by two filters that could be changed apart and drift into overlapping.
 */
export function partitionSpaces<T extends PlaceableSpace>(
  spaces: readonly T[],
): { hierarchy: T[]; subjects: T[] } {
  const hierarchy: T[] = [];
  const subjects: T[] = [];
  for (const space of spaces) {
    (isSubject(space) ? subjects : hierarchy).push(space);
  }
  return { hierarchy, subjects };
}

/** Whether a subject belongs to the function of this name, however spelled. */
export function isInFunction(space: PlaceableSpace, name: string): boolean {
  const placement = placementOf(space.labels);
  return (
    placement.axis === "function" &&
    normLabel(placement.function) === normLabel(name)
  );
}

/** Whether a subject belongs to this category of this function. */
export function isInCategory(
  space: PlaceableSpace,
  functionName: string,
  categoryName: string,
): boolean {
  const placement = placementOf(space.labels);
  return (
    placement.axis === "function" &&
    normLabel(placement.function) === normLabel(functionName) &&
    placement.category !== undefined &&
    normLabel(placement.category) === normLabel(categoryName)
  );
}

/** The function and category names a set of spaces uses, each named once. */
export function namesUsedBy(
  spaces: readonly PlaceableSpace[],
): { function: string; category?: string }[] {
  const seen = new Set<string>();
  const used: { function: string; category?: string }[] = [];
  for (const space of spaces) {
    const placement = placementOf(space.labels);
    if (placement.axis !== "function") continue;
    const key = `${normLabel(placement.function)}>${normLabel(placement.category ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    used.push({
      function: placement.function,
      ...(placement.category ? { category: placement.category } : {}),
    });
  }
  return used;
}
