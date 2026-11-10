/**
 * How a wiki page is named to a person, as opposed to how it is stored.
 *
 * A page's path is an identity: it routes, keys revisions and is what the
 * ingest writes to, so it keeps its `.md` everywhere it is used as a key, a
 * URL segment or an API argument. Nobody reads a wiki in files, though, so
 * every surface that *names* a page for a reader comes through here and
 * agrees on the same name.
 *
 * Pure: a path goes in, a name comes out.
 */

/** The extension every stored page path carries. */
const MARKDOWN_SUFFIX = /\.mdx?$/i;

/** The page's own name: the leaf of its path, without the extension. */
export function pageDisplayName(path: string): string {
  const leaf = path.slice(path.lastIndexOf("/") + 1);
  const named = leaf.replace(MARKDOWN_SUFFIX, "");
  return named || leaf || path;
}

/**
 * The whole path as a reader would read it — folders kept, extension gone.
 *
 * For surfaces that list pages from several folders at once, where the leaf
 * alone would leave two "overview" rows indistinguishable.
 */
export function pageDisplayPath(path: string): string {
  const trimmed = path.replace(MARKDOWN_SUFFIX, "");
  return trimmed || path;
}

/**
 * Put a name typed by a reader back into a stored path.
 *
 * The rename field shows the extension-less name, so what comes back out of
 * it has to be given the extension again before it can be a page path.
 */
export function asPagePath(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  return MARKDOWN_SUFFIX.test(trimmed) ? trimmed : `${trimmed}.md`;
}

/**
 * Where a page lands when it is renamed to `name`.
 *
 * Renaming names a page, it does not move it: the folder it sits in is kept
 * whatever is typed, so a name with slashes in it is read as a name rather
 * than as a path to somewhere else. Empty when nothing usable was typed,
 * which callers read as "no rename to do".
 */
export function renamedPagePath(oldPath: string, name: string): string {
  const typed = name.trim().split(/[\\/]/).pop()?.trim() ?? "";
  const filename = asPagePath(typed);
  if (!filename) return "";
  return `${oldPath.slice(0, oldPath.lastIndexOf("/") + 1)}${filename}`;
}
