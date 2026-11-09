"use client";

import { useEffect, useState } from "react";

import { useFunctionTaxonomy } from "@/hooks/use-function-taxonomy";
import { relatedSpaces } from "@/lib/projects/function-taxonomy";

/** Another space tagged alongside this one, named rather than slugged. */
export interface RelatedSpaceRow {
  slug: string;
  title: string;
  /** The categories both spaces carry. */
  through: string[];
}

/**
 * The spaces tagged into the same categories as this one.
 *
 * The taxonomy stores slugs, which are what survives a rename, but a reader
 * standing in one space wants the other one's name. So the catalogue is read
 * once for titles and a space whose title cannot be found is still listed,
 * under its slug, rather than disappearing from the group it belongs to.
 */
export function useRelatedSpaces(slug: string): {
  related: RelatedSpaceRow[];
  ready: boolean;
} {
  const { taxonomy, ready } = useFunctionTaxonomy();
  const [titles, setTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json();
        const rows = body?.data?.projects;
        if (cancelled || !Array.isArray(rows)) return;
        const found: Record<string, string> = {};
        for (const row of rows) {
          if (typeof row?.slug !== "string") continue;
          found[row.slug] = row.title || row.name || row.slug;
        }
        setTitles(found);
      } catch {
        // Without the catalogue the group is still shown, by slug.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    ready,
    related: relatedSpaces(taxonomy, slug).map((row) => ({
      ...row,
      title: titles[row.slug] ?? row.slug,
    })),
  };
}
