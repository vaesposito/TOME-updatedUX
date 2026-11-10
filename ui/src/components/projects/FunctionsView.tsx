"use client";

import { Layers, Plus, Users } from "lucide-react";
import * as React from "react";

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
import { SpaceCreationFlow } from "@/components/projects/SpaceCreationFlow";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useFunctionTaxonomy } from "@/hooks/use-function-taxonomy";
import {
  categorySlug,
  withSubjectNames,
  type FunctionCategory,
  type OrgFunction,
} from "@/lib/projects/function-taxonomy";
import { isInCategory, isInFunction } from "@/lib/projects/placement";
import type { FunctionOption } from "@/lib/projects/space-creation";
import { projectMatchesQuery } from "@/lib/tome/project-search";
import { projectGridClassName } from "@/lib/tome/project-grid";

/**
 * The organisation, read as its functions.
 *
 * The function axis in full: Function → Category → Subject. It is shaped like
 * the catalogue's BHAG → Area → Project because a reader moving between the
 * two should not have to learn a second way of moving through a hierarchy —
 * but it holds different records. A subject is not a project read another
 * way, and nothing in this view appears in the catalogue.
 *
 * Where a subject sits is read off the subject: `labels.functions` and
 * `labels.categories`. The stored taxonomy supplies names only, so that a
 * function with nothing in it yet is still drawn and a category a deployment
 * has named is still offered.
 *
 * What a reader makes here is a subject, never a category: a category is a
 * word this deployment names in its configuration, and a subject is a space.
 * So a function or a category row carries exactly what a BHAG or an Area row
 * carries — a caret, a name, a count — and nothing is edited in place.
 */

export function FunctionsView({
  subjects,
  onSubjectCreated,
}: {
  subjects: EnrichedProject[];
  /** Fetch the catalogue again, so a new subject lands where it was made. */
  onSubjectCreated?: () => void;
}) {
  const { taxonomy } = useFunctionTaxonomy();
  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  // The team the spaces around it already use, so the one field a reader
  // cannot guess is filled in before they are asked for it.
  const defaultTeamSlug = subjects[0]?.team_slug || subjects[0]?.team_id;

  // Widened by what the subjects themselves name, so a subject whose function
  // or category this deployment never configured is still drawn somewhere.
  const vocabulary = withSubjectNames(taxonomy, subjects);

  const functionOptions: FunctionOption[] = vocabulary.functions.map((fn) => ({
    name: fn.name,
    categories: fn.categories.map((category) => category.name),
  }));

  /**
   * What the search leaves, matched exactly as the catalogue matches.
   *
   * The same function over the same records, so the two fields behave
   * alike: subjects are what is filtered, and a function or a category
   * survives because something inside it matched. Naming the function or
   * the category itself keeps everything under it, since both are part of
   * what a space is matched on.
   */
  const normalizedQuery = query.trim();
  const shownSubjects = normalizedQuery
    ? subjects.filter((subject) => projectMatchesQuery(subject, normalizedQuery))
    : subjects;

  /** Subjects naming this function but none of its categories. */
  const looseIn = (fn: OrgFunction) =>
    shownSubjects.filter(
      (subject) =>
        isInFunction(subject, fn.name) &&
        !fn.categories.some((category) =>
          isInCategory(subject, fn.name, category.name),
        ),
    );

  const held = (fn: OrgFunction) =>
    fn.categories
      .map((category) => ({
        category,
        subjects: shownSubjects.filter((subject) =>
          isInCategory(subject, fn.name, category.name),
        ),
      }))
      // With nothing typed every category is drawn, empty or not: the view is
      // the whole organisation. Under a query it has to hold a match.
      .filter((entry) => !normalizedQuery || entry.subjects.length > 0);

  const active = vocabulary.functions
    .map((fn) => ({ fn, categories: held(fn), loose: looseIn(fn) }))
    .filter(
      (entry) =>
        !normalizedQuery ||
        entry.categories.length > 0 ||
        entry.loose.length > 0,
    );

  return (
    <section className="space-y-6">
      {/* The catalogue's own toolbar, the same component: a reader moving
          between the two axes should not have to learn a second way of
          narrowing one or a second place to add to it. */}
      <HubToolbar
        heading={
          <HubHeading>
            {normalizedQuery
              ? `${shownSubjects.length} of ${subjects.length} subjects`
              : `${subjects.length} ${subjects.length === 1 ? "subject" : "subjects"}`}
          </HubHeading>
        }
      >
        <HubSearchField
          value={query}
          onChange={setQuery}
          placeholder="Find subject…"
          label="Find a TOME subject"
          clearLabel="Clear subject search"
        />

        {/* One offer, where the catalogue makes its one offer. Where the new
            subject goes is asked by the flow, as it has to be once the
            button no longer hangs off the row that would have said. */}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setCreating(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add subject
        </Button>
      </HubToolbar>

      {active.length === 0 && (
        <p className="py-6 text-sm text-muted-foreground">
          No subject matches “{normalizedQuery}”.
        </p>
      )}

      {/* The cards inside carry the same hovercards the catalogue's do, so
          they are given the same delay to open. */}
      <TooltipProvider>
        <div className="space-y-8">
          {active.map(({ fn, categories, loose }) => (
            <FunctionGroup
              key={fn.id}
              fn={fn}
              // The subjects under it, counted once: the whole of what the
              // function keeps, rather than how many groups it keeps them in.
              count={
                new Set([
                  ...categories.flatMap(({ subjects: inside }) =>
                    inside.map((subject) => subject.slug),
                  ),
                  ...loose.map((subject) => subject.slug),
                ]).size
              }
              categories={categories}
              loose={loose}
            />
          ))}
        </div>
      </TooltipProvider>

      <SpaceCreationFlow
        open={creating}
        onOpenChange={setCreating}
        placement={{ function: vocabulary.functions[0]?.name ?? "" }}
        functionOptions={functionOptions}
        defaultTeamSlug={defaultTeamSlug}
        onCreated={() => onSubjectCreated?.()}
      />
    </section>
  );
}

/** One function and everything under it, as a BHAG group is drawn. */
function FunctionGroup({
  fn,
  count,
  categories,
  loose,
}: {
  fn: OrgFunction;
  count: number;
  categories: { category: FunctionCategory; subjects: EnrichedProject[] }[];
  loose: EnrichedProject[];
}) {
  return (
    <HubGroup
      name={fn.name}
      /* A function has no space of its own to open, so unlike a BHAG its
         name does what the row does rather than leading somewhere. */
      labelClassName="text-sm font-semibold text-primary"
      icon={<Users className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
      count={count}
    >
      <div className="space-y-4">
        {/* Categories sit where areas sit in the catalogue: a level of their
            own between the function and the subjects, each holding the same
            cards the catalogue draws. */}
        {categories.length > 0 && (
          <div className="space-y-3">
            {categories.map(({ category, subjects }) => (
              <CategorySubGroup
                key={category.id}
                category={category}
                subjects={subjects}
                href={`/projects/functions/${categorySlug(fn, category)}`}
              />
            ))}
          </div>
        )}

        {categories.length > 0 && loose.length > 0 && (
          <p className="pl-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            In this function (no category)
          </p>
        )}

        {/* A subject naming the function and no category sits at the
            function's own level, as a project naming a BHAG and no area
            does in the catalogue. */}
        {loose.length > 0 && (
          <div className={projectGridClassName()}>
            {loose.map((subject) => (
              <ProjectCard key={subject.slug} project={subject} />
            ))}
          </div>
        )}

        {categories.length === 0 && loose.length === 0 && (
          <p className="py-1 text-xs text-muted-foreground/70">
            No categories yet. Divide this function&apos;s work to group its
            subjects.
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
 * the same icon, its own count, and under it the subjects that name it as
 * the cards every other list of spaces draws them. Its name leads to its own
 * page, as an area's leads to its wiki.
 */
function CategorySubGroup({
  category,
  subjects,
  href,
}: {
  category: FunctionCategory;
  subjects: EnrichedProject[];
  /** The category's own page, read as the catalogue's projects are read. */
  href: string;
}) {
  return (
    <HubGroup
      level="nested"
      name={category.name}
      href={href}
      labelClassName="text-sm font-semibold text-sky-500"
      icon={<Layers className="h-3.5 w-3.5 shrink-0 text-sky-500" aria-hidden />}
      count={subjects.length}
    >
      {subjects.length > 0 ? (
        <div className={projectGridClassName()}>
          {subjects.map((subject) => (
            <ProjectCard key={subject.slug} project={subject} />
          ))}
        </div>
      ) : (
        <p className="py-1 text-xs text-muted-foreground/70">
          No subjects in this category yet.
        </p>
      )}
    </HubGroup>
  );
}
