"use client";

import Link from "next/link";
import { ArrowRight, Pencil, Plus, Users } from "lucide-react";
import * as React from "react";

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
import { cn } from "@/lib/utils";

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
  const [pickedFunction, setPickedFunction] = React.useState<string | null>(null);
  const [pickedCategory, setPickedCategory] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<CategoryDraft | null>(null);

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

  const active = pickedFunction
    ? taxonomy.functions.filter((fn) => fn.id === pickedFunction)
    : taxonomy.functions;
  const pickedFn = taxonomy.functions.find((fn) => fn.id === pickedFunction);

  const openNew = (functionId: string) =>
    setDraft({ functionId, name: "", spaces: [] });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold text-foreground">
            {taxonomy.functions.length} functions
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

        <button
          type="button"
          onClick={() => openNew(pickedFunction ?? taxonomy.functions[0]?.id ?? "")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-accent/60 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New category
        </button>
      </div>

      <div className="space-y-2">
        <Chips
          label="Filter by function"
          all="All functions"
          active={pickedFunction}
          onPick={(id) => {
            setPickedFunction(id);
            setPickedCategory(null);
          }}
          options={taxonomy.functions.map((fn) => ({
            id: fn.id,
            name: fn.name,
            count: countIn(fn),
          }))}
        />

        {/* Only once a function is chosen: two categories of the same name
            under different functions are different things, and a flat list
            of every category in the organisation could not tell them apart. */}
        {pickedFn && pickedFn.categories.length > 0 && (
          <Chips
            label={`Filter by category in ${pickedFn.name}`}
            all="All categories"
            active={pickedCategory}
            onPick={setPickedCategory}
            options={pickedFn.categories.map((category) => ({
              id: category.id,
              name: category.name,
              count: category.spaces.length,
            }))}
          />
        )}
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {active.map((fn) => {
          const categories = pickedCategory
            ? fn.categories.filter((c) => c.id === pickedCategory)
            : fn.categories;
          const loose = pickedCategory ? [] : looseIn(fn);

          return (
            <li
              key={fn.id}
              className="rounded-xl border border-border bg-card/40 p-4"
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
                  {pickedCategory
                    ? "Nothing tagged into it yet."
                    : "No categories yet. Divide this function's work to group its spaces."}
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {categories.map((category) => (
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

                      {category.spaces.length === 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Nothing tagged yet.
                        </p>
                      ) : (
                        <SpaceList
                          spaces={category.spaces.map(
                            (slug) =>
                              titles.get(slug) ?? {
                                slug,
                                title: slug,
                                functions: [],
                              },
                          )}
                        />
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

              {!pickedCategory && (
                <button
                  type="button"
                  onClick={() => openNew(fn.id)}
                  className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                  Add category
                </button>
              )}
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

/** One row of filters: everything, or one of them, with how much each holds. */
function Chips({
  label,
  all,
  active,
  options,
  onPick,
}: {
  label: string;
  all: string;
  active: string | null;
  options: { id: string; name: string; count: number }[];
  onPick: (id: string | null) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      <Chip on={active === null} onClick={() => onPick(null)}>
        {all}
      </Chip>
      {options.map((option) => (
        <Chip
          key={option.id}
          on={active === option.id}
          onClick={() => onPick(active === option.id ? null : option.id)}
        >
          {option.name}
          <span className="ml-1.5 tabular-nums opacity-60">{option.count}</span>
        </Chip>
      ))}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition",
        on
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
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
