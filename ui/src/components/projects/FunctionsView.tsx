"use client";

import { Layers, Plus, Users } from "lucide-react";
import * as React from "react";

import {
  FunctionCategoryDialog,
  type CategoryDraft,
  type TaggableSpace,
} from "@/components/projects/FunctionCategoryDialog";
import { HubGroup } from "@/components/projects/HubGroup";
import {
  HubHeading,
  HubSearchField,
  HubToolbar,
} from "@/components/projects/HubToolbar";
import {
  ProjectCard,
  type EnrichedProject,
} from "@/components/projects/ProjectCard";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useFunctionTaxonomy } from "@/hooks/use-function-taxonomy";
import {
  categorySlug,
  spacesInFunction,
  type FunctionCategory,
  type OrgFunction,
} from "@/lib/projects/function-taxonomy";
import { normLabel } from "@/lib/projects/labels";
import { projectGridClassName } from "@/lib/tome/project-grid";

/**
 * The organisation, read as its functions.
 *
 * The catalogue's own hierarchy with one vocabulary swapped for another:
 * where it reads BHAG → Area → Project, this reads Function → Category →
 * Project. A category is therefore the level an area is — a group with its
 * own page, holding project cards — and not a card of its own.
 *
 * Everything that draws it is the catalogue's own: the same collapsing
 * group, the same nested group under it, the same grid, the same card.
 * A reader switching between the two readings is looking at one set of
 * projects and should not have to learn a second way of moving through them.
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
      {/* The catalogue's own toolbar, the same component: a reader moving
          between the two readings of the same thing should not have to learn
          a second way of narrowing it or a second place to add to it. */}
      <HubToolbar
        heading={
          <HubHeading>
            {terms.length > 0
              ? `${active.length} of ${taxonomy.functions.length} functions`
              : `${taxonomy.functions.length} functions`}
          </HubHeading>
        }
      >
        <HubSearchField
          value={query}
          onChange={setQuery}
          placeholder="Find function…"
          label="Find a function, category or project"
          clearLabel="Clear function search"
        />

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => openNew(taxonomy.functions[0]?.id ?? "")}
        >
          <Plus className="h-3.5 w-3.5" />
          Add category
        </Button>
      </HubToolbar>

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
                // The projects under it, counted once however many of its
                // categories hold them: the whole of what the function
                // keeps, rather than how many groups it keeps them in.
                fn={fn}
                count={
                  new Set([
                    ...categories.flatMap(({ projects }) =>
                      projects.map((entry) => entry.slug),
                    ),
                    ...loose.map((entry) => entry.slug),
                  ]).size
                }
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
  return (
    <HubGroup
      name={fn.name}
      /* A function has no space of its own to open, so unlike a BHAG its
         name does what the row does rather than leading somewhere. */
      labelClassName="text-sm font-semibold text-primary"
      icon={<Users className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
      count={count}
      action={{ label: "Add category", onClick: onAddCategory }}
    >
      <div className="space-y-4">
        {/* Categories sit where areas sit in the catalogue: a level of their
            own between the function and the projects, each holding the same
            cards the catalogue draws. */}
        {categories.length > 0 && (
          <div className="space-y-3">
            {categories.map(({ category, projects }) => (
              <CategorySubGroup
                key={category.id}
                category={category}
                projects={projects}
                href={`/projects/functions/${categorySlug(fn, category)}`}
                onEdit={() => onEditCategory(category)}
              />
            ))}
          </div>
        )}

        {categories.length > 0 && loose.length > 0 && (
          <p className="pl-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Tagged directly (no category)
          </p>
        )}

        {/* A project its function claims but no category does sits at the
            function's own level, as a project tagged to a BHAG and no area
            does in the catalogue. */}
        {loose.length > 0 && (
          <div className={projectGridClassName()}>
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
    </HubGroup>
  );
}

/**
 * One category, drawn where the catalogue draws an area.
 *
 * The same nested group: the same indentation and rule down its left side,
 * the same icon, its own count, and under it the projects tagged into it as
 * the cards every other list of projects draws them. Its name leads to its
 * own page, as an area's leads to its wiki.
 */
function CategorySubGroup({
  category,
  projects,
  href,
  onEdit,
}: {
  category: FunctionCategory;
  projects: FunctionProject[];
  /** The category's own page, read as the catalogue's projects are read. */
  href: string;
  onEdit: () => void;
}) {
  return (
    <HubGroup
      level="nested"
      name={category.name}
      href={href}
      labelClassName="text-sm font-semibold text-sky-500"
      icon={<Layers className="h-3.5 w-3.5 shrink-0 text-sky-500" aria-hidden />}
      count={projects.length}
      action={{ label: "Edit category", onClick: onEdit }}
    >
      {projects.length > 0 ? (
        <div className={projectGridClassName()}>
          {projects.map((entry) => (
            <ProjectCard key={entry.slug} project={entry.project} />
          ))}
        </div>
      ) : (
        <p className="py-1 text-xs text-muted-foreground/70">
          No projects tagged into this category yet.
        </p>
      )}
    </HubGroup>
  );
}

/** Everything in no function, drawn as the catalogue draws Ungrouped. */
function UnassignedGroup({ projects }: { projects: FunctionProject[] }) {
  return (
    <HubGroup
      name="Unassigned"
      labelClassName="text-sm font-medium text-muted-foreground"
      count={projects.length}
    >
      <div className={projectGridClassName()}>
        {projects.map((entry) => (
          <ProjectCard key={entry.slug} project={entry.project} />
        ))}
      </div>
    </HubGroup>
  );
}
