"use client";

import Link from "next/link";
import { ArrowLeft, FolderKanban, Layers, Search } from "lucide-react";
import * as React from "react";

import {
  HubHeading,
  HubSearchField,
  HubToolbar,
} from "@/components/projects/HubToolbar";
import {
  ProjectCard,
  type EnrichedProject,
} from "@/components/projects/ProjectCard";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useFunctionTaxonomy } from "@/hooks/use-function-taxonomy";
import { TomeEmpty } from "@/components/tome/TomeEmpty";
import {
  findCategoryBySlug,
  withSubjectNames,
} from "@/lib/projects/function-taxonomy";
import { isInCategory, partitionSpaces } from "@/lib/projects/placement";
import { projectMatchesQuery } from "@/lib/tome/project-search";
import { projectGridClassName } from "@/lib/tome/project-grid";

/**
 * One category, read the way the catalogue is read.
 *
 * A category is a set of subjects, so it is drawn as a set of subjects: the
 * same count, the same toolbar, the same cards the hub draws. What a reader
 * came for on either screen is the same thing, and the way through it should
 * not change on the way in.
 *
 * Which subjects those are is read off the subjects themselves, so this page
 * holds whatever the records say whichever browser opens it. Only the
 * category's *name* comes from the device, and a name no browser holds is
 * recovered from the subjects that use it.
 */
export function FunctionCategoryView({ slug }: { slug: string }) {
  const { taxonomy, ready } = useFunctionTaxonomy();
  const [subjects, setSubjects] = React.useState<EnrichedProject[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/projects");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load projects");
        const spaces = (body.data?.projects ?? []) as EnrichedProject[];
        if (live) setSubjects(partitionSpaces(spaces).subjects);
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Resolved only once the device's own copy is in hand: until then the
  // vocabulary is the empty one the server rendered.
  const vocabulary = withSubjectNames(taxonomy, subjects);
  const found = ready ? findCategoryBySlug(vocabulary, slug) : null;

  const inCategory = found
    ? subjects.filter((subject) =>
        isInCategory(subject, found.fn.name, found.category.name),
      )
    : [];

  const normalizedQuery = query.trim();
  const shown = normalizedQuery
    ? inCategory.filter((subject) => projectMatchesQuery(subject, normalizedQuery))
    : inCategory;

  return (
    <div className="relative isolate mx-auto w-full max-w-[1600px] space-y-8 p-6">
      <div className="space-y-2">
        <Link
          href="/projects?tab=functions"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          By function
        </Link>

        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight md:text-3xl">
          <Layers
            className="h-7 w-7 shrink-0 text-sky-500 md:h-8 md:w-8"
            aria-hidden
          />
          {found ? found.category.name : "Category"}
        </h1>

        {found && (
          <p className="text-sm leading-6 text-muted-foreground">
            How {found.fn.name} divides its work.
          </p>
        )}
      </div>

      {(!ready || loading) && !found && (
        <p className="text-sm text-muted-foreground">Loading category…</p>
      )}

      {ready && !loading && !found && (
        <div className="rounded-2xl border border-dashed border-border">
          <TomeEmpty
            icon={<Layers />}
            headline="No such category"
            hint="A category is named by this deployment or by the subjects that sit in it. Nothing names this one. By function shows the categories that exist."
            action={{ label: "By function", href: "/projects?tab=functions" }}
          />
        </div>
      )}

      {found && (
        <section className="space-y-6">
          <HubToolbar
            heading={
              <HubHeading>
                {loading
                  ? found.category.name
                  : normalizedQuery
                    ? `${shown.length} of ${inCategory.length} subjects`
                    : `${inCategory.length} ${inCategory.length === 1 ? "subject" : "subjects"}`}
              </HubHeading>
            }
          >
            <HubSearchField
              value={query}
              onChange={setQuery}
              placeholder="Find subject…"
              label="Find a subject in this category"
              clearLabel="Clear subject search"
            />
          </HubToolbar>

          {loading && (
            <p className="text-sm text-muted-foreground">Loading subjects…</p>
          )}

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {!loading && inCategory.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border">
              <TomeEmpty
                icon={<FolderKanban />}
                headline="No subjects in this category yet"
                hint="A subject joins a category by naming it. Name this one on a subject and it appears here as it appears under By function."
              />
            </div>
          )}

          {!loading && inCategory.length > 0 && shown.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border">
              <TomeEmpty
                icon={<Search />}
                headline="No subjects match your search"
                hint={`Nothing in this category matches \u201C${normalizedQuery}\u201D. Clearing the search brings every subject back.`}
                action={{ label: "Clear search", onClick: () => setQuery("") }}
              />
            </div>
          )}

          {shown.length > 0 && (
            <TooltipProvider>
              <div className={projectGridClassName()}>
                {shown.map((subject) => (
                  <ProjectCard key={String(subject._id)} project={subject} />
                ))}
              </div>
            </TooltipProvider>
          )}
        </section>
      )}
    </div>
  );
}
