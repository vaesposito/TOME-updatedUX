"use client";

import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";

import { ORG_FUNCTIONS } from "@/components/projects/navigation";
import { normLabel } from "@/lib/projects/labels";

/**
 * The organisation, read as its functions.
 *
 * Not the catalogue under different headings: a reader who picked "by
 * function" is asking what each part of the organisation keeps in TOME, and
 * answering with the same wall of project cards answers the other question.
 * So the functions are the content here, and the spaces inside one are named
 * rather than restated as cards.
 */

/** The little a function needs to say about itself from the outside. */
export interface FunctionSpace {
  slug: string;
  title: string;
  functions: string[];
}

export function FunctionsView({ spaces }: { spaces: FunctionSpace[] }) {
  const owned = new Map<string, FunctionSpace[]>(
    ORG_FUNCTIONS.map((name) => [normLabel(name), []]),
  );
  const unassigned: FunctionSpace[] = [];

  for (const space of spaces) {
    const tags = space.functions.filter((tag) => owned.has(normLabel(tag)));
    if (tags.length === 0) {
      unassigned.push(space);
      continue;
    }
    for (const tag of tags) owned.get(normLabel(tag))!.push(space);
  }

  return (
    <section className="space-y-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-lg font-semibold text-foreground">
          {ORG_FUNCTIONS.length} functions
        </h2>
        {unassigned.length > 0 && (
          // One line rather than a sixth card: spaces with no function are
          // something to fix, not a part of the organisation.
          <p className="text-xs text-muted-foreground">
            {unassigned.length} space{unassigned.length === 1 ? "" : "s"} not
            assigned to one yet
          </p>
        )}
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ORG_FUNCTIONS.map((name) => {
          const held = owned.get(normLabel(name)) ?? [];
          return (
            <li
              key={name}
              className="rounded-xl border border-border bg-card/40 p-4"
            >
              <div className="flex items-center gap-2">
                <Users
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {name}
                </h3>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {held.length}
                </span>
              </div>

              {held.length === 0 ? (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Nothing here yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {held.map((space) => (
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
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
