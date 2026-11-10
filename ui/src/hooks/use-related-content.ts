"use client";

import { useEffect, useState } from "react";

/** One page, somewhere else, that tags the space being read. */
export interface RelatedContentRow {
  /** The space the page lives in, which is where the reader has to go. */
  spaceSlug: string;
  spaceTitle: string;
  path: string;
  title: string;
  wholePage: boolean;
  passages: number;
}

interface TaggedContentResponse {
  space_slug?: unknown;
  space_title?: unknown;
  path?: unknown;
  title?: unknown;
  whole_page?: unknown;
  passages?: unknown;
}

function toRow(raw: TaggedContentResponse): RelatedContentRow | null {
  if (typeof raw?.space_slug !== "string" || typeof raw?.path !== "string") return null;
  return {
    spaceSlug: raw.space_slug,
    spaceTitle: typeof raw.space_title === "string" ? raw.space_title : raw.space_slug,
    path: raw.path,
    title: typeof raw.title === "string" && raw.title ? raw.title : raw.path,
    wholePage: raw.whole_page === true,
    passages: typeof raw.passages === "number" ? raw.passages : 0,
  };
}

/**
 * The pages that tag this space.
 *
 * Relatedness is a claim content makes, not something derived from the two
 * trees: the axes are disjoint, so a tag on a page is the only thing that
 * connects a Project to a Subject. Resolved on the server, because the pages
 * live in other spaces and which of those this reader may open is an
 * authorization question the browser cannot answer.
 */
export function useRelatedContent(slug: string): {
  related: RelatedContentRow[];
  ready: boolean;
} {
  const [related, setRelated] = useState<RelatedContentRow[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    void (async () => {
      try {
        const response = await fetch(
          `/api/tome/projects/${encodeURIComponent(slug)}/tagged-content`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`tagged content ${response.status}`);
        const body = await response.json();
        const rows = body?.data?.items;
        if (cancelled) return;
        setRelated(Array.isArray(rows) ? rows.map(toRow).filter((row): row is RelatedContentRow => row !== null) : []);
      } catch {
        // An unreachable index is an empty list, not a broken page: the rail
        // simply says nothing has tagged this space yet.
        if (!cancelled) setRelated([]);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return { related, ready };
}
