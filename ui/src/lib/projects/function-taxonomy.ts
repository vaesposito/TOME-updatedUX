/**
 * The organisation as functions, and the categories a function keeps.
 *
 * A vocabulary, not a placement. A function is the part of the organisation
 * that owns a space and the list of them barely changes; a category is how
 * that part of the organisation divides its own work, and only the people in
 * it know what those divisions are. So functions ship fixed and categories
 * are made by whoever needs them. Which subject sits in which category is not
 * decided here — a subject names its own function and category on itself, and
 * `lib/projects/placement` reads that.
 *
 * Pure: no React, no storage, no fetch. Everything here is a reading of a
 * taxonomy or a new taxonomy derived from an old one, which is what makes it
 * testable and what will make it easy to move behind an API later.
 */

import { normLabel } from "@/lib/projects/labels";
import { namesUsedBy, type PlaceableSpace } from "@/lib/projects/placement";

/** A division of one function's work. */
export interface FunctionCategory {
  id: string;
  name: string;
}

/** A part of the organisation, and how it divides its own work. */
export interface OrgFunction {
  id: string;
  name: string;
  /** True of the five that ship with TOME, which cannot be deleted. */
  builtIn?: boolean;
  categories: FunctionCategory[];
}

export interface FunctionTaxonomy {
  functions: OrgFunction[];
}

/**
 * The functions that ship.
 *
 * Fixed rather than derived from whatever subjects happen to exist: the
 * point of the view is to show the whole organisation, including the parts
 * with nothing in TOME yet, since an absent function and an empty one read
 * identically once the list is only what was found.
 */
export const BUILT_IN_FUNCTIONS = [
  "SLT",
  "Engineering",
  "Marketing",
  "Product Design",
  "Business Development",
] as const;

/**
 * An organisation with its parts named and nothing inside them.
 *
 * No categories are seeded. What a function calls its own divisions is not
 * something this code can know, and a guessed set would have to be deleted
 * before the right one could be made.
 */
export function defaultTaxonomy(): FunctionTaxonomy {
  return {
    functions: BUILT_IN_FUNCTIONS.map((name) => ({
      id: idFor(name),
      name,
      builtIn: true,
      categories: [],
    })),
  };
}

/** A stable id from a name, so the same name in two tabs is the same thing. */
function idFor(name: string): string {
  const stem = normLabel(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return stem || "unnamed";
}

/** An id nothing else in `taken` is using, suffixed only when it has to be. */
function uniqueId(name: string, taken: Set<string>): string {
  const stem = idFor(name);
  if (!taken.has(stem)) return stem;
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Every id in use, so a new one can avoid all of them. */
function allIds(taxonomy: FunctionTaxonomy): Set<string> {
  const ids = new Set<string>();
  for (const fn of taxonomy.functions) {
    ids.add(fn.id);
    for (const category of fn.categories) ids.add(category.id);
  }
  return ids;
}

/**
 * Read whatever was stored back into a taxonomy.
 *
 * Forgiving by design: this is read from a browser that may hold a copy
 * written by an older build, and a shape that cannot be understood should
 * cost the reader their categories, not the page. The built-in functions are
 * put back whether or not the stored copy had them, so a reader who stored a
 * taxonomy before a function existed still sees it.
 */
export function normaliseTaxonomy(raw: unknown): FunctionTaxonomy {
  const source = (raw && typeof raw === "object" ? raw : {}) as {
    functions?: unknown;
  };
  const stored = Array.isArray(source.functions) ? source.functions : [];

  const byId = new Map<string, OrgFunction>();
  for (const entry of stored) {
    const fn = readFunction(entry);
    if (fn && !byId.has(fn.id)) byId.set(fn.id, fn);
  }

  for (const name of BUILT_IN_FUNCTIONS) {
    const id = idFor(name);
    const existing = byId.get(id);
    // Named and marked from the constant, so renaming a built-in function in
    // the code renames it for readers who already have one stored.
    byId.set(id, existing
      ? { ...existing, name, builtIn: true }
      : { id, name, builtIn: true, categories: [] });
  }

  // Built-ins first, in the order they are declared, then whatever was made
  // since: a list that reorders itself as categories are added is a list
  // nobody can find anything in twice.
  const builtIn = BUILT_IN_FUNCTIONS.map((name) => byId.get(idFor(name))!);
  const added = [...byId.values()].filter((fn) => !fn.builtIn);
  return { functions: [...builtIn, ...added] };
}

function readFunction(raw: unknown): OrgFunction | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  if (!name) return null;
  const id = typeof entry.id === "string" && entry.id ? entry.id : idFor(name);
  const categories = Array.isArray(entry.categories)
    ? entry.categories.map(readCategory).filter((c): c is FunctionCategory => c !== null)
    : [];
  return { id, name, categories };
}

function readCategory(raw: unknown): FunctionCategory | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  if (!name) return null;
  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : idFor(name),
    name,
  };
}

/** A function, and the divisions a deployment says it keeps. */
export interface ConfiguredFunction {
  function: string;
  categories: string[];
}

/**
 * Read the categories a deployment ships with.
 *
 * Written as `Function: One, Two | Other Function: Three`, because this is
 * set by whoever runs TOME and an operator editing one line of configuration
 * should not have to write JSON to do it. Blank, malformed or half-written
 * entries are dropped rather than refused: a typo in configuration should
 * cost that one category, not the whole view.
 */
export function parseConfiguredCategories(raw: string | undefined | null): ConfiguredFunction[] {
  if (!raw) return [];
  const groups: ConfiguredFunction[] = [];
  for (const chunk of raw.split("|")) {
    const at = chunk.indexOf(":");
    if (at < 0) continue;
    const name = chunk.slice(0, at).trim();
    if (!name) continue;
    const categories = chunk
      .slice(at + 1)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (categories.length > 0) groups.push({ function: name, categories });
  }
  return groups;
}

/**
 * Put the configured categories into a taxonomy, adding only what is missing.
 *
 * Additive, so a reader keeps their own categories and whatever they tagged
 * into the configured ones. A function named in configuration that does not
 * ship is created, since a deployment knows its own organisation better than
 * the constant does.
 */
export function withConfiguredCategories(
  taxonomy: FunctionTaxonomy,
  raw: string | undefined | null,
): FunctionTaxonomy {
  let next = taxonomy;
  for (const group of parseConfiguredCategories(raw)) {
    let target = next.functions.find(
      (fn) => normLabel(fn.name) === normLabel(group.function),
    );
    if (!target) {
      const made = addFunction(next, group.function);
      next = made.taxonomy;
      target = next.functions.find((fn) => fn.id === made.id);
    }
    if (!target) continue;
    for (const name of group.categories) {
      if (hasCategoryNamed(next, target.id, name)) continue;
      next = addCategory(next, target.id, name).taxonomy;
    }
  }
  return next;
}

/**
 * The configured vocabulary widened by the words the subjects actually use.
 *
 * A subject naming a function or a category this deployment never configured
 * is still somewhere, and that somewhere has to be drawn or the subject is
 * invisible. Added rather than configured, so the vocabulary a view renders
 * from is always at least as wide as the records it is rendering.
 */
export function withSubjectNames(
  taxonomy: FunctionTaxonomy,
  subjects: readonly PlaceableSpace[],
): FunctionTaxonomy {
  let next = taxonomy;
  for (const used of namesUsedBy(subjects)) {
    let target = next.functions.find(
      (fn) => normLabel(fn.name) === normLabel(used.function),
    );
    if (!target) {
      const made = addFunction(next, used.function);
      next = made.taxonomy;
      target = next.functions.find((fn) => fn.id === made.id);
    }
    if (!target || !used.category) continue;
    if (hasCategoryNamed(next, target.id, used.category)) continue;
    next = addCategory(next, target.id, used.category).taxonomy;
  }
  return next;
}

/**
 * Bring a taxonomy from one configuration to the next.
 *
 * A category the configuration has stopped naming is taken out, so renaming
 * one in configuration reads as a rename rather than leaving the old name
 * beside the new. Nothing is lost by taking one out: a category subjects
 * still name comes back from the subjects themselves.
 */
export function reconcileConfiguredCategories(
  taxonomy: FunctionTaxonomy,
  previous: string | undefined | null,
  current: string | undefined | null,
): FunctionTaxonomy {
  const named = new Map<string, Set<string>>();
  for (const group of parseConfiguredCategories(current)) {
    const key = normLabel(group.function);
    const set = named.get(key) ?? new Set<string>();
    for (const name of group.categories) set.add(normLabel(name));
    named.set(key, set);
  }

  let next = taxonomy;
  for (const group of parseConfiguredCategories(previous)) {
    const stillNamed = named.get(normLabel(group.function)) ?? new Set<string>();
    for (const name of group.categories) {
      if (stillNamed.has(normLabel(name))) continue;
      // Looked up afresh each time, since the one before may have gone.
      const fn = next.functions.find(
        (candidate) => normLabel(candidate.name) === normLabel(group.function),
      );
      const retired = fn?.categories.find(
        (category) => normLabel(category.name) === normLabel(name),
      );
      if (retired) next = removeCategory(next, retired.id);
    }
  }

  return withConfiguredCategories(next, current);
}

/** Whether this function already divides its work that way. */
export function hasCategoryNamed(
  taxonomy: FunctionTaxonomy,
  functionId: string,
  name: string,
): boolean {
  const fn = taxonomy.functions.find((f) => f.id === functionId);
  return (fn?.categories ?? []).some((c) => normLabel(c.name) === normLabel(name));
}

/**
 * Add a function, or return the taxonomy untouched if it is already there.
 *
 * Silent rather than throwing: the caller is a form, and a form that has
 * already checked the name should not have to catch anything.
 */
export function addFunction(
  taxonomy: FunctionTaxonomy,
  name: string,
): { taxonomy: FunctionTaxonomy; id: string } {
  const trimmed = name.trim();
  const existing = taxonomy.functions.find(
    (fn) => normLabel(fn.name) === normLabel(trimmed),
  );
  if (!trimmed || existing) {
    return { taxonomy, id: existing?.id ?? "" };
  }
  const id = uniqueId(trimmed, allIds(taxonomy));
  return {
    taxonomy: {
      functions: [...taxonomy.functions, { id, name: trimmed, categories: [] }],
    },
    id,
  };
}

/** Add a category to a function, or return the one already named that. */
export function addCategory(
  taxonomy: FunctionTaxonomy,
  functionId: string,
  name: string,
): { taxonomy: FunctionTaxonomy; id: string } {
  const trimmed = name.trim();
  const target = taxonomy.functions.find((fn) => fn.id === functionId);
  if (!trimmed || !target) return { taxonomy, id: "" };

  const existing = target.categories.find(
    (c) => normLabel(c.name) === normLabel(trimmed),
  );
  if (existing) return { taxonomy, id: existing.id };

  const id = uniqueId(`${target.name}-${trimmed}`, allIds(taxonomy));
  return {
    taxonomy: mapFunction(taxonomy, functionId, (fn) => ({
      ...fn,
      categories: [...fn.categories, { id, name: trimmed }],
    })),
    id,
  };
}

/** Remove a category from the vocabulary. */
export function removeCategory(
  taxonomy: FunctionTaxonomy,
  categoryId: string,
): FunctionTaxonomy {
  return {
    functions: taxonomy.functions.map((fn) => ({
      ...fn,
      categories: fn.categories.filter((c) => c.id !== categoryId),
    })),
  };
}

function mapFunction(
  taxonomy: FunctionTaxonomy,
  functionId: string,
  fn: (f: OrgFunction) => OrgFunction,
): FunctionTaxonomy {
  return {
    functions: taxonomy.functions.map((f) => (f.id === functionId ? fn(f) : f)),
  };
}


/**
 * A category's address.
 *
 * Both ids, because a category id is unique only inside the taxonomy that
 * made it and a link has to say which function's division it means. Neither
 * id can hold a double dash — ids are built from `[a-z0-9]` runs joined by
 * single dashes — so the pair splits back apart unambiguously.
 */
export function categorySlug(
  fn: Pick<OrgFunction, "id">,
  category: Pick<FunctionCategory, "id">,
): string {
  return `${fn.id}--${category.id}`;
}

/** The function and category a slug names, if this taxonomy holds them. */
export function findCategoryBySlug(
  taxonomy: FunctionTaxonomy,
  slug: string,
): { fn: OrgFunction; category: FunctionCategory } | null {
  for (const fn of taxonomy.functions) {
    for (const category of fn.categories) {
      if (categorySlug(fn, category) === slug) return { fn, category };
    }
  }
  return null;
}
