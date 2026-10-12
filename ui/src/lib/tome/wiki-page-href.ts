/**
 * Where a wiki page lives, and how to read a page path back out of one.
 *
 * These two belong together. A notification records which page it is about
 * only in its link, so anything mapping notifications back onto the tree has
 * to undo exactly what the sender did — and will break silently if the two
 * ever drift apart.
 */

/** The link a notification about `pagePath` points at. */
export function wikiPageHref(entitySlug: string, pagePath: string): string {
  return `/projects/${encodeURIComponent(entitySlug)}/tome/wiki/${pagePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

/**
 * The page a link points at, or null if it does not point at one.
 *
 * Entity landing pages, agent panes and off-site links all land here and all
 * answer null: the caller is asking "is this about a wiki page", not just
 * "where does this go".
 */
export function wikiPagePathFromHref(href: string): string | null {
  // Fragments and query strings are navigation detail, not part of the path.
  const path = href.split("#")[0]?.split("?")[0] ?? "";
  const match = /^\/projects\/[^/]+\/tome\/wiki\/(.+)$/.exec(path);
  if (!match?.[1]) return null;
  try {
    return match[1].split("/").map(decodeURIComponent).join("/");
  } catch {
    // A malformed escape means this is not a link we wrote.
    return null;
  }
}
