"use client";

import Link from "next/link";
import { ArrowRight, Pencil, Plus, Search, Users, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";

import {
  FunctionCategoryDialog,
  type CategoryDraft,
} from "@/components/projects/FunctionCategoryDialog";
import { useFunctionTaxonomy } from "@/hooks/use-function-taxonomy";
import {
  spacesInFunction,
  type OrgFunction,
} from "@/lib/projects/function-taxonomy";
import { normLabel } from "@/lib/projects/labels";

/**
 * The organisation, read as its functions.
 *
 * Not the catalogue under different headings: a reader who picked "by
 * function" is asking what each part of the organisation keeps in TOME, and
 * answering with the same wall of project cards answers the other question.
 * So the functions are the content here, and the spaces inside one are named
 * rather than restated as cards.
 *
 * Below each function are its categories — the divisions that function makes
 * in its own work — and the filter above narrows to one of either, because a
 * reader who came looking for one part of marketing should not have to read
 * the other four functions to find it.
 */

/** The little a function needs to say about itself from the outside. */
export interface FunctionSpace {
  slug: string;
  title: string;
  /** Functions named on the space itself, which predate categories. */
  functions: string[];
}

export function FunctionsView({ spaces }: { spaces: FunctionSpace[] }) {
  const { taxonomy, update } = useFunctionTaxonomy();
  const [query, setQuery] = React.useState("");
  const [draft, setDraft] = React.useState<CategoryDraft | null>(null);

  // Split and matched exactly as the catalogue's own field does it: every
  // word must appear somewhere in the thing, so a second word narrows the
  // first rather than widening it.
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (...text: (string | undefined)[]) => {
    const haystack = text.filter(Boolean).join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  };

  const titles = new Map(spaces.map((space) => [space.slug, space]));

  /** Spaces naming this function on themselves but tagged into none of its categories. */
  const looseIn = (fn: OrgFunction) => {
    const held = new Set(spacesInFunction(fn));
    return spaces.filter(
      (space) =>
        !held.has(space.slug) &&
        space.functions.some((tag) => normLabel(tag) === normLabel(fn.name)),
    );
  };

  const countIn = (fn: OrgFunction) =>
    spacesInFunction(fn).length + looseIn(fn).length;

  const placed = new Set(
    taxonomy.functions.flatMap((fn) => [
      ...spacesInFunction(fn),
      ...looseIn(fn).map((space) => space.slug),
    ]),
  );
  const unplaced = spaces.filter((space) => !placed.has(space.slug));

  /**
   * What a search leaves of one function.
   *
   * A query reaches all three levels, because a reader typing "events" may
   * be after the function, the category or the space, and cannot be asked
   * which before they have found it. Naming the function keeps everything
   * under it; naming something inside keeps the function and narrows it to
   * what was named.
   */
  const named = (slug: string): FunctionSpace =>
    titles.get(slug) ?? { slug, title: slug, functions: [] };

  const narrow = (fn: OrgFunction) => {
    const all = fn.categories.map((category) => ({
      category,
      spaces: category.spaces.map(named),
    }));
    if (terms.length === 0) {
      return { categories: all, loose: looseIn(fn), shown: true };
    }

    // The function's own name counts towards everything under it, so
    // "marketing events" reaches a category only that function has. Named
    // outright it keeps all of itself; reached through something inside, it
    // keeps only what was reached.
    const whole = hit(fn.name);
    const categories = all
      .map(({ category, spaces }) => {
        const named = whole || hit(fn.name, category.name);
        return {
          category,
          spaces: named
            ? spaces
            : spaces.filter((space) =>
                hit(fn.name, category.name, space.title, space.slug),
              ),
          named,
        };
      })
      .filter((entry) => entry.named || entry.spaces.length > 0);
    const loose = looseIn(fn).filter(
      (space) => whole || hit(fn.name, space.title, space.slug),
    );
    return {
      categories,
      loose,
      shown: whole || categories.length > 0 || loose.length > 0,
    };
  };

  const active = taxonomy.functions.filter((fn) => narrow(fn).shown);

  const openNew = (functionId: string) =>
    setDraft({ functionId, name: "", spaces: [] });

  return (
    <section className="space-y-4">
      {/* The catalogue's own toolbar, to the letter: a reader moving between
          the two readings of the same thing should not have to learn a second
          way of narrowing it or a second place to add to it. */}
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h2 className="whitespace-nowrap text-xl font-semibold">
            {terms.length > 0
              ? `${active.length} of ${taxonomy.functions.length} functions`
              : `${taxonomy.functions.length} functions`}
          </h2>
          {unplaced.length > 0 && (
            // One line rather than a sixth card: spaces in no function are
            // something to fix, not a part of the organisation.
            <p className="text-xs text-muted-foreground">
              {unplaced.length} space{unplaced.length === 1 ? "" : "s"} not
              assigned to one yet
            </p>
          )}
        </div>

        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find function…"
              aria-label="Find a function, category or space"
              className="h-8 w-full rounded-lg border border-border/60 bg-background/40 pl-8 pr-8 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 hover:border-border focus:border-primary/50 focus:bg-background focus:ring-2 focus:ring-primary/15 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear function search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => openNew(taxonomy.functions[0]?.id ?? "")}
          >
            <Plus className="h-3.5 w-3.5" />
            Add category
          </Button>
        </div>
      </div>

      {active.length === 0 && (
        <p className="py-6 text-sm text-muted-foreground">
          No function, category or space matches “{query.trim()}”.
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {active.map((fn) => {
          const { categories, loose } = narrow(fn);

          return (
            <li
              key={fn.id}
              className="group/fn rounded-xl border border-border bg-card/40 p-4"
            >
              <div className="flex items-center gap-2">
                <Users
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {fn.name}
                </h3>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {countIn(fn)}
                </span>
              </div>

              {categories.length === 0 && loose.length === 0 ? (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  No categories yet. Divide this function&apos;s work to group
                  its spaces.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {categories.map(({ category, spaces: held }) => (
                    <div key={category.id}>
                      <div className="group/cat flex items-center gap-1.5">
                        <h4 className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                          {category.name}
                        </h4>
                        <button
                          type="button"
                          aria-label={`Edit ${category.name}`}
                          onClick={() =>
                            setDraft({
                              functionId: fn.id,
                              categoryId: category.id,
                              name: category.name,
                              spaces: category.spaces,
                            })
                          }
                          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition hover:text-foreground focus:opacity-100 group-hover/cat:opacity-100"
                        >
                          <Pencil className="h-3 w-3" aria-hidden />
                        </button>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {category.spaces.length}
                        </span>
                      </div>

                      {held.length === 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Nothing tagged yet.
                        </p>
                      ) : (
                        <SpaceList spaces={held} />
                      )}
                    </div>
                  ))}

                  {loose.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground">
                        Not in a category
                      </h4>
                      <SpaceList spaces={loose} />
                    </div>
                  )}
                </div>
              )}

              {/* Beside the function it would belong to, so the form opens
                  on the right one. Quiet, and quieter still while nothing
                  is being pointed at. */}
              <button
                type="button"
                onClick={() => openNew(fn.id)}
                className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground opacity-0 transition hover:text-foreground focus:opacity-100 group-hover/fn:opacity-100"
              >
                <Plus className="h-3 w-3" aria-hidden />
                Add category
              </button>
            </li>
          );
        })}
      </ul>

      {draft && (
        <FunctionCategoryDialog
          open
          onOpenChange={(open) => !open && setDraft(null)}
          taxonomy={taxonomy}
          spaces={spaces}
          draft={draft}
          onCommit={update}
        />
      )}
    </section>
  );
}

function SpaceList({ spaces }: { spaces: FunctionSpace[] }) {
  return (
    <ul className="mt-1.5 space-y-1.5">
      {spaces.map((space) => (
        <li key={space.slug}>
          <Link
            href={`/projects/${encodeURIComponent(space.slug)}/tome`}
            className="group flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <span className="min-w-0 truncate">{space.title}</span>
            <ArrowRight
              className="h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-100"
              aria-hidden
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
