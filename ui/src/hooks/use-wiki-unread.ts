"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Which wiki pages of an entity have activity the reader has not opened.
 *
 * Kept here rather than in the sidebar so the tree stays a presentational
 * component, and so the one fetch serves every row rather than each row
 * asking after itself.
 */
export function useWikiUnread(slug: string): {
  /** Page paths to dot. */
  unreadPaths: ReadonlySet<string>;
  /** Clear one page's dot, because the reader just opened it. */
  markPageRead: (path: string) => void;
} {
  // Path -> the notification ids behind its dot, which is what marking it
  // read has to name. The paths alone would not be enough to clear it.
  const [byPage, setByPage] = useState<Record<string, string[]>>({});
  // Pages cleared in this session. Kept apart from `byPage` so that a reload
  // of the map — after someone else's save, say — cannot bring a dot back
  // that the reader has already dealt with. Tagged with the entity it was
  // collected under, because page paths repeat across entities and a
  // `charter.md` read here must not silence the one next door.
  const [cleared, setCleared] = useState<{
    slug: string;
    paths: ReadonlySet<string>;
  }>(() => ({ slug, paths: new Set() }));

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(slug)}/wiki/unread`,
          { cache: "no-store" },
        );
        if (!response.ok || cancelled) return;
        const body = await response.json();
        if (!cancelled) setByPage((body?.data ?? body)?.pages ?? {});
      } catch {
        // A missing dot is not worth an error state. The inbox still has it.
      }
    };
    void read();
    // The same event the bell listens for, so a save anywhere in the app
    // dots the page it touched without a reload.
    const refresh = () => void read();
    window.addEventListener("in-app-notifications:refresh", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("in-app-notifications:refresh", refresh);
    };
  }, [slug]);

  const markPageRead = useCallback((path: string) => {
    setByPage((current) => {
      const ids = current[path];
      if (!ids?.length) return current;
      setCleared((done) => ({
        slug,
        paths: new Set(done.slug === slug ? done.paths : []).add(path),
      }));
      // Opening a page is not a request to be told about it, so the bell is
      // left to pick this up on its own schedule rather than being refreshed
      // from under the reader mid-navigation.
      void fetch("/api/notifications/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, read: true }),
      }).catch(() => {});
      const next = { ...current };
      delete next[path];
      return next;
    });
  }, [slug]);

  const unreadPaths = useMemo(() => {
    // Derived rather than reset on navigation: a stale set simply does not
    // apply to the entity now on screen.
    const done = cleared.slug === slug ? cleared.paths : null;
    return new Set(Object.keys(byPage).filter((path) => !done?.has(path)));
  }, [byPage, cleared, slug]);
  return { unreadPaths, markPageRead };
}
