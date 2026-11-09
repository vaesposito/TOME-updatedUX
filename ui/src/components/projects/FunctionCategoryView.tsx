"use client";

import Link from "next/link";
import { ArrowLeft, FolderKanban, Layers, Plus, Search } from "lucide-react";
import * as React from "react";

import {
  FunctionCategoryDialog,
  type TaggableSpace,
} from "@/components/projects/FunctionCategoryDialog";
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
import { TomeEmpty } from "@/components/tome/TomeEmpty";
import { findCategoryBySlug } from "@/lib/projects/function-taxonomy";
import { projectMatchesQuery } from "@/lib/tome/project-search";
import { projectGridClassName } from "@/lib/tome/project-grid";

/**
 * One category, read the way the catalogue is read.
 *
 * A category is a set of projects, so it is drawn as a set of projects: the
 * same count, the same toolbar, the same cards the hub draws, rather than
 * the condensed list of names the card in the function view has room for.
 * What a reader came for on either screen is the same thing, and the way
 * through it should not change on the way in.
 *
 * The taxonomy is held by the browser, not the server, so this view can be
 * opened on a device that has never heard of the category in the address.
 * That is a real limit of where categories live, and it is said plainly
 * rather than drawn as a broken page.
 */
export function FunctionCategoryView({ slug }: { slug: string }) {
  const { taxonomy, ready, update } = useFunctionTaxonomy();
  const [projects, setProjects] = React.useState<EnrichedProject[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/projects");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load projects");
        if (live) setProjects((body.data?.projects ?? []) as EnrichedProject[]);
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
  // taxonomy is the empty one the server rendered, and every category in it
  // is unknown.
  const found = ready ? findCategoryBySlug(taxonomy, slug) : null;

  const bySlug = new Map(projects.map((project) => [project.slug, project]));
  const tagged = (found?.category.spaces ?? [])
    .map((tag) => bySlug.get(tag))
    .filter((project): project is EnrichedProject => project !== undefined);

  const normalizedQuery = query.trim();
  const shown = normalizedQuery
    ? tagged.filter((project) => projectMatchesQuery(project, normalizedQuery))
    : tagged;

  const taggable: TaggableSpace[] = projects.map((project) => ({
    slug: project.slug,
    title: project.title || project.name || project.slug,
  }));

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

      {!ready && (
        <p className="text-sm text-muted-foreground">Loading category…</p>
      )}

      {ready && !found && (
        <div className="rounded-2xl border border-dashed border-border">
          <TomeEmpty
            icon={<Layers />}
            headline="No such category on this device"
            hint="Categories are kept by the browser that made them, so a link to one opens empty elsewhere. By function shows the categories this browser holds."
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
                    ? `${shown.length} of ${tagged.length} projects`
                    : `${tagged.length} ${tagged.length === 1 ? "project" : "projects"}`}
              </HubHeading>
            }
          >
            <HubSearchField
              value={query}
              onChange={setQuery}
              placeholder="Find project…"
              label="Find a project in this category"
              clearLabel="Clear project search"
            />

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setEditing(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add projects
            </Button>
          </HubToolbar>

          {loading && (
            <p className="text-sm text-muted-foreground">Loading projects…</p>
          )}

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {!loading && tagged.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border">
              <TomeEmpty
                icon={<FolderKanban />}
                headline="Nothing tagged into this category yet"
                hint="A category holds whichever projects were tagged into it. Tag one and it appears here as it appears in the catalogue."
                action={{
                  label: "Add projects",
                  onClick: () => setEditing(true),
                }}
              />
            </div>
          )}

          {!loading && tagged.length > 0 && shown.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border">
              <TomeEmpty
                icon={<Search />}
                headline="No projects match your search"
                hint={`Nothing in this category matches \u201C${normalizedQuery}\u201D. Clearing the search brings every project back.`}
                action={{ label: "Clear search", onClick: () => setQuery("") }}
              />
            </div>
          )}

          {shown.length > 0 && (
            <TooltipProvider>
              <div className={projectGridClassName()}>
                {shown.map((project) => (
                  <ProjectCard key={String(project._id)} project={project} />
                ))}
              </div>
            </TooltipProvider>
          )}
        </section>
      )}

      {found && editing && (
        <FunctionCategoryDialog
          open
          onOpenChange={(open) => !open && setEditing(false)}
          taxonomy={taxonomy}
          spaces={taggable}
          draft={{
            functionId: found.fn.id,
            categoryId: found.category.id,
            name: found.category.name,
            spaces: found.category.spaces,
          }}
          onCommit={update}
        />
      )}
    </div>
  );
}
