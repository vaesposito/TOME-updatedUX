"use client";

import Link from "next/link";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Layers,
  Pencil,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";
import * as React from "react";

import {
  FunctionCategoryDialog,
  type CategoryDraft,
  type TaggableSpace,
} from "@/components/projects/FunctionCategoryDialog";
import {
  ProjectCard,
  type EnrichedProject,
} from "@/components/projects/ProjectCard";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useFunctionTaxonomy } from "@/hooks/use-function-taxonomy";
import {
  spacesInFunction,
  type FunctionCategory,
  type OrgFunction,
} from "@/lib/projects/function-taxonomy";
import { normLabel } from "@/lib/projects/labels";
import { projectGridClassName } from "@/lib/tome/project-grid";

/**
 * The organisation, read as its functions.
 *
 * Two levels, not three: a function where the catalogue puts a group, and
 * its categories where the catalogue puts the project cards. A category is
 * the thing a reader came here for, so it is the card, and the projects it
 * holds are named inside it rather than given a level of their own.
 *
 * Everything else is the catalogue's own — the same collapsing group, the
 * same grid, the same card — because a reader switching between the two
 * readings is looking at one set of projects and should not have to learn a
 * second way of moving through them.
 */

/** A project, as a function's hierarchy needs to see it. */
interface FunctionProject {
  slug: string;
  title: string;
  /** Functions named on the project itself, which predate categories. */
  functions: string[];
  project: EnrichedProject;
}

export function FunctionsView({ projects }: { projects: EnrichedProject[] }) {
  const { taxonomy, update } = useFunctionTaxonomy();
  const [query, setQuery] = React.useState("");
  const [draft, setDraft] = React.useState<CategoryDraft | null>(null);

  const all: FunctionProject[] = projects.map((project) => ({
    slug: project.slug,
    title: project.title || project.name || project.slug,
    functions: project.labels?.functions ?? [],
    project,
  }));
  const bySlug = new Map(all.map((entry) => [entry.slug, entry]));

  // Split and matched exactly as the catalogue's own field does it: every
  // word must appear somewhere in the thing, so a second word narrows the
  // first rather than widening it.
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (...text: (string | undefined)[]) => {
    const haystack = text.filter(Boolean).join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  };

  /** Projects naming this function on themselves but in none of its categories. */
  const looseIn = (fn: OrgFunction) => {
    const held = new Set(spacesInFunction(fn));
    return all.filter(
      (entry) =>
        !held.has(entry.slug) &&
        entry.functions.some((tag) => normLabel(tag) === normLabel(fn.name)),
    );
  };

  const named = (slug: string): FunctionProject | null => bySlug.get(slug) ?? null;

  /**
   * What a search leaves of one function.
   *
   * A query reaches all three levels, because a reader typing "events" may
   * be after the function, the category or the project, and cannot be asked
   * which before they have found it. The function's own name counts towards
   * everything under it: named outright it keeps all of itself, reached
   * through something inside it keeps only what was reached.
   */
  const narrow = (fn: OrgFunction) => {
    const held = fn.categories.map((category) => ({
      category,
      projects: category.spaces
        .map(named)
        .filter((entry): entry is FunctionProject => entry !== null),
    }));
    if (terms.length === 0) {
      return { categories: held, loose: looseIn(fn), shown: true };
    }

    const whole = hit(fn.name);
    const categories = held
      .map(({ category, projects: inside }) => {
        const byName = whole || hit(fn.name, category.name);
        return {
          category,
          projects: byName
            ? inside
            : inside.filter((entry) =>
                hit(fn.name, category.name, entry.title, entry.slug),
              ),
          byName,
        };
      })
      .filter((entry) => entry.byName || entry.projects.length > 0);
    const loose = looseIn(fn).filter(
      (entry) => whole || hit(fn.name, entry.title, entry.slug),
    );
    return {
      categories,
      loose,
      shown: whole || categories.length > 0 || loose.length > 0,
    };
  };

  const active = taxonomy.functions.filter((fn) => narrow(fn).shown);

  // Projects in no function at all, drawn last and under their own heading,
  // as the catalogue draws the ones in no BHAG.
  const placed = new Set(
    taxonomy.functions.flatMap((fn) => [
      ...spacesInFunction(fn),
      ...looseIn(fn).map((entry) => entry.slug),
    ]),
  );
  const unassigned = all
    .filter((entry) => !placed.has(entry.slug))
    .filter((entry) => terms.length === 0 || hit(entry.title, entry.slug));

  const openNew = (functionId: string) =>
    setDraft({ functionId, name: "", spaces: [] });

  const taggable: TaggableSpace[] = all.map(({ slug, title }) => ({ slug, title }));

  return (
    <section className="space-y-6">
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
        </div>

        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find function…"
              aria-label="Find a function, category or project"
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

      {active.length === 0 && unassigned.length === 0 && (
        <p className="py-6 text-sm text-muted-foreground">
          No function, category or project matches “{query.trim()}”.
        </p>
      )}

      {/* The cards inside carry the same hovercards the catalogue's do, so
          they are given the same delay to open. */}
      <TooltipProvider>
        <div className="space-y-8">
          {active.map((fn) => {
            const { categories, loose } = narrow(fn);
            return (
              <FunctionGroup
                key={fn.id}
                // What sits directly under it, as the catalogue counts a
                // group: the cards a reader will see when it opens.
                fn={fn}
                count={categories.length + loose.length}
                categories={categories}
                loose={loose}
                onAddCategory={() => openNew(fn.id)}
                onEditCategory={(category) =>
                  setDraft({
                    functionId: fn.id,
                    categoryId: category.id,
                    name: category.name,
                    spaces: category.spaces,
                  })
                }
              />
            );
          })}

          {unassigned.length > 0 && <UnassignedGroup projects={unassigned} />}
        </div>
      </TooltipProvider>

      {draft && (
        <FunctionCategoryDialog
          open
          onOpenChange={(open) => !open && setDraft(null)}
          taxonomy={taxonomy}
          spaces={taggable}
          draft={draft}
          onCommit={update}
        />
      )}
    </section>
  );
}

/** One function and everything under it, as a BHAG group is drawn. */
function FunctionGroup({
  fn,
  count,
  categories,
  loose,
  onAddCategory,
  onEditCategory,
}: {
  fn: OrgFunction;
  count: number;
  categories: { category: FunctionCategory; projects: FunctionProject[] }[];
  loose: FunctionProject[];
  onAddCategory: () => void;
  onEditCategory: (category: FunctionCategory) => void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <div className="group/group relative space-y-3 rounded-xl transition">
      <div className="flex items-center gap-3">
        <Caret
          collapsed={collapsed}
          label={fn.name}
          onToggle={() => setCollapsed((c) => !c)}
        />

        <Users className="h-4 w-4 shrink-0 text-primary" aria-hidden />

        {/* A function has no space of its own to open, so unlike a BHAG its
            name does what the row does rather than leading somewhere. */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="min-w-0 truncate text-left text-sm font-semibold text-primary"
        >
          {fn.name}
        </button>

        <span className="shrink-0 text-xs text-muted-foreground/50">{count}</span>

        <button
          type="button"
          onClick={onAddCategory}
          className="shrink-0 text-xs text-muted-foreground opacity-0 transition hover:text-foreground focus:opacity-100 group-hover/group:opacity-100"
        >
          Add category
        </button>

        <span className="ml-1 h-px flex-grow bg-border/40" />
      </div>

      {!collapsed && (
        <div className="space-y-4">
          {/* Categories sit where projects sit in the catalogue: one level
              under the group, as cards, rather than as a second set of
              headings with cards under those. What a category holds is
              named inside it, which is as deep as this needs to go. */}
          {(categories.length > 0 || loose.length > 0) && (
            <div className={projectGridClassName()}>
              {categories.map(({ category, projects }) => (
                <CategoryCard
                  key={category.id}
                  category={category}
                  projects={projects}
                  onEdit={() => onEditCategory(category)}
                />
              ))}

              {/* A project its function claims but no category does belongs
                  at this level too, as itself. */}
              {loose.map((entry) => (
                <ProjectCard key={entry.slug} project={entry.project} />
              ))}
            </div>
          )}

          {categories.length === 0 && loose.length === 0 && (
            <p className="py-1 text-xs text-muted-foreground/70">
              No categories yet. Divide this function&apos;s work to group its
              projects.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One category, drawn where the catalogue draws a project.
 *
 * The same card, carrying what a category is instead of what a project is:
 * its name, how much it holds, and the projects themselves named inside it
 * so they can still be reached in one click.
 */
function CategoryCard({
  category,
  projects,
  onEdit,
}: {
  category: FunctionCategory;
  projects: FunctionProject[];
  onEdit: () => void;
}) {
  return (
    <div className="group/cat flex flex-col rounded-2xl border border-border/60 bg-card/50 p-5 transition hover:border-primary/40 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <h3 className="inline-flex min-w-0 items-center gap-2 font-semibold leading-snug">
          <Layers className="h-4 w-4 shrink-0 text-sky-500" aria-hidden />
          <span className="truncate">{category.name}</span>
        </h3>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${category.name}`}
          className="shrink-0 rounded text-muted-foreground opacity-0 transition hover:text-foreground focus:opacity-100 group-hover/cat:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <span className="mt-0.5 text-[11px] text-muted-foreground">
        {category.spaces.length}{" "}
        {category.spaces.length === 1 ? "project" : "projects"}
      </span>

      {projects.length === 0 ? (
        <p className="mt-3 flex-grow text-sm text-muted-foreground">
          Nothing tagged into it yet.
        </p>
      ) : (
        <ul className="mt-3 flex-grow space-y-1.5">
          {projects.map((entry) => (
            <li key={entry.slug}>
              <Link
                href={`/projects/${encodeURIComponent(entry.slug)}`}
                className="group/row flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
              >
                <span className="min-w-0 truncate">{entry.title}</span>
                <ArrowRight
                  className="h-3 w-3 shrink-0 opacity-0 transition group-hover/row:opacity-100"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Everything in no function, drawn as the catalogue draws Ungrouped. */
function UnassignedGroup({ projects }: { projects: FunctionProject[] }) {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <div className="relative space-y-3 rounded-xl transition">
      <div className="flex items-center gap-3">
        <Caret
          collapsed={collapsed}
          label="Unassigned"
          onToggle={() => setCollapsed((c) => !c)}
        />
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="min-w-0 truncate text-left text-sm font-medium text-muted-foreground"
        >
          Unassigned
        </button>
        <span className="shrink-0 text-xs text-muted-foreground/50">
          {projects.length}
        </span>
        <span className="ml-1 h-px flex-grow bg-border/40" />
      </div>

      {!collapsed && (
        <div className={projectGridClassName()}>
          {projects.map((entry) => (
            <ProjectCard key={entry.slug} project={entry.project} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The one control that opens and closes a function. */
function Caret({
  collapsed,
  label,
  onToggle,
}: {
  collapsed: boolean;
  label: string;
  onToggle: () => void;
}) {
  const Icon = collapsed ? ChevronRight : ChevronDown;
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
      onClick={onToggle}
      className="shrink-0 text-muted-foreground transition hover:text-foreground"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
