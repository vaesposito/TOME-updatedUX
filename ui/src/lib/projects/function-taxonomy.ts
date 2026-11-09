/**
 * The organisation as functions, the categories a function keeps, and which
 * spaces sit in each.
 *
 * Two levels rather than one flat set of tags. A function is the part of the
 * organisation that owns a space and the list of them barely changes;
 * a category is how that part of the organisation divides its own work, and
 * only the people in it know what those divisions are. So functions ship
 * fixed and categories are made by whoever needs them.
 *
 * Pure: no React, no storage, no fetch. Everything here is a reading of a
 * taxonomy or a new taxonomy derived from an old one, which is what makes it
 * testable and what will make it easy to move behind an API later.
 */

import { normLabel } from "@/lib/projects/labels";

/** A division of one function's work, holding whichever spaces were tagged into it. */
export interface FunctionCategory {
  id: string;
  name: string;
  /** Project slugs, in the order they were tagged. */
  spaces: string[];
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
 * Fixed rather than derived from whatever spaces happen to be tagged: the
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
  const spaces = Array.isArray(entry.spaces)
    ? entry.spaces.filter((s): s is string => typeof s === "string" && s.length > 0)
    : [];
  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : idFor(name),
    name,
    spaces: [...new Set(spaces)],
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

/** One category, and the projects a deployment says sit in it. */
export interface ConfiguredTag {
  function: string;
  category: string;
  spaces: string[];
}

/**
 * Read which projects a deployment puts in which category.
 *
 * Written as `Function > Category: slug, other-slug | …`. The function is
 * named as well as the category because two functions may divide their work
 * by the same word and mean different things by it.
 */
export function parseConfiguredTags(raw: string | undefined | null): ConfiguredTag[] {
  if (!raw) return [];
  const tags: ConfiguredTag[] = [];
  for (const chunk of raw.split("|")) {
    const at = chunk.indexOf(":");
    if (at < 0) continue;
    const [fn, category] = chunk.slice(0, at).split(">").map((part) => part.trim());
    if (!fn || !category) continue;
    const spaces = chunk
      .slice(at + 1)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (spaces.length > 0) tags.push({ function: fn, category, spaces });
  }
  return tags;
}

/** The category this tag names, if the taxonomy has it. */
function categoryFor(
  taxonomy: FunctionTaxonomy,
  tag: { function: string; category: string },
): FunctionCategory | undefined {
  const fn = taxonomy.functions.find(
    (candidate) => normLabel(candidate.name) === normLabel(tag.function),
  );
  return fn?.categories.find(
    (category) => normLabel(category.name) === normLabel(tag.category),
  );
}

/**
 * Put the configured projects into their categories, keeping what is there.
 *
 * A tag naming a category that does not exist is ignored rather than
 * creating one: the categories line says what exists, and a typo in a tag
 * should not quietly invent a division of the work.
 */
export function withConfiguredTags(
  taxonomy: FunctionTaxonomy,
  raw: string | undefined | null,
): FunctionTaxonomy {
  let next = taxonomy;
  for (const tag of parseConfiguredTags(raw)) {
    const category = categoryFor(next, tag);
    if (!category) continue;
    const wanted = tag.spaces.filter((slug) => !category.spaces.includes(slug));
    if (wanted.length === 0) continue;
    next = setSpaces(next, category.id, [...category.spaces, ...wanted]);
  }
  return next;
}

/**
 * Bring a taxonomy from one configuration to the next.
 *
 * A category the configuration has stopped naming is taken out, so renaming
 * one in configuration reads as a rename rather than leaving the old name
 * beside the new. Only while it is empty, though: once someone has tagged a
 * space into it, it is theirs, and configuration no longer gets to delete it.
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
        (category) =>
          normLabel(category.name) === normLabel(name) &&
          category.spaces.length === 0,
      );
      if (retired) next = removeCategory(next, retired.id);
    }
  }

  return withConfiguredCategories(next, current);
}

/** Everything a deployment says about the organisation, in two lines. */
export interface TaxonomyConfig {
  categories?: string | null;
  tags?: string | null;
}

/**
 * Bring a taxonomy from one whole configuration to the next.
 *
 * Tags are retired before categories, so a category emptied by the change is
 * free to be retired itself and a rename of both reads as a rename. Only
 * pairs the previous configuration named are taken out: a project someone
 * tagged by hand was never configuration's to remove.
 */
export function reconcileConfiguration(
  taxonomy: FunctionTaxonomy,
  previous: TaxonomyConfig,
  current: TaxonomyConfig,
): FunctionTaxonomy {
  const stillTagged = new Map<string, Set<string>>();
  for (const tag of parseConfiguredTags(current.tags)) {
    const key = `${normLabel(tag.function)}>${normLabel(tag.category)}`;
    const set = stillTagged.get(key) ?? new Set<string>();
    for (const slug of tag.spaces) set.add(slug);
    stillTagged.set(key, set);
  }

  let next = taxonomy;
  for (const tag of parseConfiguredTags(previous.tags)) {
    const key = `${normLabel(tag.function)}>${normLabel(tag.category)}`;
    const keep = stillTagged.get(key) ?? new Set<string>();
    const retired = tag.spaces.filter((slug) => !keep.has(slug));
    if (retired.length === 0) continue;
    const category = categoryFor(next, tag);
    if (!category) continue;
    next = setSpaces(
      next,
      category.id,
      category.spaces.filter((slug) => !retired.includes(slug)),
    );
  }

  next = reconcileConfiguredCategories(next, previous.categories, current.categories);
  return withConfiguredTags(next, current.tags);
}

/** Whether a function of this name already exists, however it was capitalised. */
export function hasFunctionNamed(taxonomy: FunctionTaxonomy, name: string): boolean {
  return taxonomy.functions.some((fn) => normLabel(fn.name) === normLabel(name));
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

/** Add a category to a function, with the spaces it starts out holding. */
export function addCategory(
  taxonomy: FunctionTaxonomy,
  functionId: string,
  name: string,
  spaces: readonly string[] = [],
): { taxonomy: FunctionTaxonomy; id: string } {
  const trimmed = name.trim();
  const target = taxonomy.functions.find((fn) => fn.id === functionId);
  if (!trimmed || !target) return { taxonomy, id: "" };

  const existing = target.categories.find(
    (c) => normLabel(c.name) === normLabel(trimmed),
  );
  if (existing) {
    return {
      taxonomy: setSpaces(taxonomy, existing.id, [...existing.spaces, ...spaces]),
      id: existing.id,
    };
  }

  const id = uniqueId(`${target.name}-${trimmed}`, allIds(taxonomy));
  return {
    taxonomy: mapFunction(taxonomy, functionId, (fn) => ({
      ...fn,
      categories: [...fn.categories, { id, name: trimmed, spaces: [...new Set(spaces)] }],
    })),
    id,
  };
}

/** Rename a category, leaving what it holds alone. */
export function renameCategory(
  taxonomy: FunctionTaxonomy,
  categoryId: string,
  name: string,
): FunctionTaxonomy {
  const trimmed = name.trim();
  if (!trimmed) return taxonomy;
  return mapCategory(taxonomy, categoryId, (c) => ({ ...c, name: trimmed }));
}

/** Replace what a category holds, dropping repeats. */
export function setSpaces(
  taxonomy: FunctionTaxonomy,
  categoryId: string,
  spaces: readonly string[],
): FunctionTaxonomy {
  return mapCategory(taxonomy, categoryId, (c) => ({
    ...c,
    spaces: [...new Set(spaces)],
  }));
}

/** Tag a space into a category, or untag it if it is already there. */
export function toggleSpace(
  taxonomy: FunctionTaxonomy,
  categoryId: string,
  slug: string,
): FunctionTaxonomy {
  return mapCategory(taxonomy, categoryId, (c) => ({
    ...c,
    spaces: c.spaces.includes(slug)
      ? c.spaces.filter((s) => s !== slug)
      : [...c.spaces, slug],
  }));
}

/** Remove a category, and with it the tags that pointed at it. */
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

/** Remove a function that was added here. The five that ship stay. */
export function removeFunction(
  taxonomy: FunctionTaxonomy,
  functionId: string,
): FunctionTaxonomy {
  return {
    functions: taxonomy.functions.filter(
      (fn) => fn.id !== functionId || fn.builtIn,
    ),
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

function mapCategory(
  taxonomy: FunctionTaxonomy,
  categoryId: string,
  fn: (c: FunctionCategory) => FunctionCategory,
): FunctionTaxonomy {
  return {
    functions: taxonomy.functions.map((f) => ({
      ...f,
      categories: f.categories.map((c) => (c.id === categoryId ? fn(c) : c)),
    })),
  };
}

/** Every space held anywhere under a function, counted once however many categories hold it. */
export function spacesInFunction(fn: OrgFunction): string[] {
  return [...new Set(fn.categories.flatMap((c) => c.spaces))];
}

/** Where one space was tagged, named so it can be said aloud. */
export interface SpacePlacement {
  functionId: string;
  functionName: string;
  categoryId: string;
  categoryName: string;
}

/** Every category a space was tagged into, across every function. */
export function placementsOf(
  taxonomy: FunctionTaxonomy,
  slug: string,
): SpacePlacement[] {
  const found: SpacePlacement[] = [];
  for (const fn of taxonomy.functions) {
    for (const category of fn.categories) {
      if (!category.spaces.includes(slug)) continue;
      found.push({
        functionId: fn.id,
        functionName: fn.name,
        categoryId: category.id,
        categoryName: category.name,
      });
    }
  }
  return found;
}

/** Another space sharing a category with this one, and the category they share. */
export interface RelatedSpace {
  slug: string;
  /** The categories both are tagged into, in the order the taxonomy lists them. */
  through: string[];
}

/**
 * The spaces tagged alongside this one.
 *
 * What a reader standing in one space wants from a tag: not the tag itself,
 * but what else carries it. A space never counts as related to itself, and a
 * pair sharing two categories is named once, through both.
 */
export function relatedSpaces(
  taxonomy: FunctionTaxonomy,
  slug: string,
): RelatedSpace[] {
  const through = new Map<string, string[]>();
  for (const fn of taxonomy.functions) {
    for (const category of fn.categories) {
      if (!category.spaces.includes(slug)) continue;
      for (const other of category.spaces) {
        if (other === slug) continue;
        const names = through.get(other) ?? [];
        names.push(category.name);
        through.set(other, names);
      }
    }
  }
  return [...through.entries()].map(([other, names]) => ({
    slug: other,
    through: names,
  }));
}
