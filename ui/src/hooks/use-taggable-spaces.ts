"use client";

import { useEffect, useState } from "react";

import type { TaggableSpace } from "@/components/tome/SpaceTagPicker";

/**
 * Every space this reader could tag content with.
 *
 * The whole catalogue, on either axis: a page in a Subject tagging a Project
 * is the motivating case, but the tag does not care which tree either side
 * sits on, so neither does the picker. Fetched once per editing session and
 * filtered in the browser — the catalogue is small, and a picker that stalls
 * on each keystroke is worse than one that loads once.
 */
export function useTaggableSpaces(options: { enabled: boolean }): TaggableSpace[] {
  const [spaces, setSpaces] = useState<TaggableSpace[]>([]);
  const enabled = options.enabled;

  useEffect(() => {
    if (!enabled || spaces.length > 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json();
        const rows = body?.data?.projects;
        if (cancelled || !Array.isArray(rows)) return;
        setSpaces(
          rows.flatMap((row: { slug?: unknown; title?: unknown; name?: unknown; type?: unknown }) =>
            typeof row?.slug === "string"
              ? [
                  {
                    slug: row.slug,
                    title:
                      (typeof row.title === "string" && row.title) ||
                      (typeof row.name === "string" && row.name) ||
                      row.slug,
                    ...(typeof row.type === "string" ? { kind: row.type } : {}),
                  },
                ]
              : [],
          ),
        );
      } catch {
        // Without the catalogue the picker simply finds nothing, which is
        // better than offering free text that could name no space at all.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, spaces.length]);

  return spaces;
}
