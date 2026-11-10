/**
 * How a page says which space its content belongs to.
 *
 * The two trees — BHAG → Area → Project and Function → Category → Subject —
 * are disjoint: a space sits on exactly one of them, and a Project and a
 * Subject are different entities. Content tagging is therefore the only thing
 * that relates them. A page written in a Subject can carry a tag naming a
 * Project, and that is what puts it in the Project's related content and in
 * its agent's knowledge.
 *
 * Two granularities, stored differently on purpose:
 *
 *   - A WHOLE page is tagged in frontmatter (`tagged_spaces: [slug, …]`).
 *     Frontmatter is already the page's own structured data: it round-trips
 *     through `parseFrontmatter`/`serializeFrontmatter`, is independent of the
 *     prose, and is the only form the server can preserve when an ingest
 *     regenerates the body (see `preserveStoredSpaceTags`).
 *
 *   - A PASSAGE is tagged inline, as a plain Markdown link to the space's own
 *     page. Same reasoning as a person mention (`./mentions.ts`): a plain
 *     link round-trips through every Markdown parser in the stack, needs no
 *     custom editor schema node to survive a save, and resolves to somewhere
 *     real when the published page is read. A dedicated `tome://` authority
 *     was rejected because it would render as a dead link — the reader could
 *     see the tag but not follow it.
 *
 * Pure: markdown goes in, slugs come out. No React, no Mongo.
 */

import { parseFrontmatter, type FrontmatterValue } from "./schema";

/** Frontmatter key carrying the spaces a whole page is tagged with. */
export const FM_TAGGED_SPACES = "tagged_spaces";

/**
 * A slug as it may appear in a tag: what the catalogue generates plus the
 * punctuation a hand-written slug might carry. Anything else is not a space
 * this product could route to, so it is not read as a tag.
 */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;

/** Every in-body tag, as the link target a reader would follow. */
const BODY_TAG =
  /\]\(\s*\/projects\/([A-Za-z0-9._~%-]+)\/tome\s*\)/g;

/** Where a tag points: the space's own landing page. */
export function spaceTagHref(slug: string): string {
  return `/projects/${encodeURIComponent(slug)}/tome`;
}

/**
 * The space a tag href names, or null when the href is not a tag.
 *
 * Deliberately exact: a link to a page *inside* a space
 * (`/projects/x/tome/wiki/charter.md`) is a reference to that page, not a
 * claim that this content belongs to the space, and must not become a row in
 * the space's related content.
 */
export function parseSpaceTagHref(href: string): string | null {
  const match = /^\/projects\/([^/?#]+)\/tome\/?$/.exec(href.trim());
  if (!match) return null;
  return normalizeSlug(match[1]);
}

function normalizeSlug(raw: string): string | null {
  let slug = raw.trim();
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // A malformed escape is not a slug this product ever wrote.
    return null;
  }
  return SLUG.test(slug) ? slug : null;
}

/**
 * How a tagged space is written into the page body.
 *
 * The `#` sigil mirrors the `@` that marks a person, so the two kinds of tag
 * read as the same gesture. Characters that would close the link early are
 * dropped from the label rather than escaped, since none of them belong in a
 * space's name.
 */
export function spaceTagMarkdown(space: { slug: string; title?: string }): string {
  const label = (space.title?.trim() || space.slug).replace(/[[\]\s]+/g, " ").trim();
  return `[#${label || space.slug}](${spaceTagHref(space.slug)})`;
}

/** What one page says about one space. */
export interface SpaceTagCount {
  /** The whole page is tagged, via frontmatter. */
  page: boolean;
  /** How many passages inside the body carry the tag. */
  passages: number;
}

/** Every space a page is tagged with, and at which granularity. */
export interface PageSpaceTags {
  /** Tagged slugs, de-duplicated, in the order they are first claimed. */
  slugs: string[];
  bySlug: Record<string, SpaceTagCount>;
}

/** The spaces named by a page's frontmatter, ignoring its body. */
export function frontmatterSpaceTags(
  fm: Record<string, FrontmatterValue>,
): string[] {
  const raw = fm[FM_TAGGED_SPACES];
  // A single tag may arrive as a bare scalar: agent-authored frontmatter is
  // plain YAML, and `tagged_spaces: one-space` is valid YAML for one item.
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const slugs: string[] = [];
  for (const value of values) {
    const slug = normalizeSlug(String(value));
    if (slug && !slugs.includes(slug)) slugs.push(slug);
  }
  return slugs;
}

/** Put a page's whole-page tags back into its frontmatter. */
export function withFrontmatterSpaceTags(
  fm: Record<string, FrontmatterValue>,
  slugs: readonly string[],
): Record<string, FrontmatterValue> {
  const next = { ...fm };
  const cleaned = slugs
    .map((slug) => normalizeSlug(slug))
    .filter((slug): slug is string => slug !== null);
  const unique = [...new Set(cleaned)];
  if (unique.length === 0) delete next[FM_TAGGED_SPACES];
  else next[FM_TAGGED_SPACES] = unique;
  return next;
}

/** Every space a page claims, from its frontmatter and from its prose. */
export function pageSpaceTags(markdown: string): PageSpaceTags {
  const [fm, body] = parseFrontmatter(markdown);
  const bySlug: Record<string, SpaceTagCount> = {};
  const slugs: string[] = [];

  const claim = (slug: string): SpaceTagCount => {
    if (!bySlug[slug]) {
      bySlug[slug] = { page: false, passages: 0 };
      slugs.push(slug);
    }
    return bySlug[slug];
  };

  for (const slug of frontmatterSpaceTags(fm)) claim(slug).page = true;

  for (const match of body.matchAll(BODY_TAG)) {
    const slug = normalizeSlug(match[1]);
    if (slug) claim(slug).passages += 1;
  }

  return { slugs, bySlug };
}

const FENCE = "---\n";

/** Render the frontmatter value, inline, as `serializeFrontmatter` would. */
function dumpSlugs(slugs: readonly string[]): string {
  return `[${slugs.join(", ")}]`;
}

/**
 * `markdown` with its `tagged_spaces` frontmatter set to `slugs`, touching
 * nothing else.
 *
 * A surgical line rewrite rather than a parse/serialize round trip, for the
 * same reason as `withKind`: agent-authored frontmatter carries block-list
 * arrays and key orderings that `serializeFrontmatter` would flatten, turning
 * a one-key correction into a whole-page diff in the revision history.
 */
export function withSpaceTags(markdown: string, slugs: readonly string[]): string {
  const line = slugs.length ? `${FM_TAGGED_SPACES}: ${dumpSlugs(slugs)}` : null;
  if (!markdown.startsWith(FENCE)) {
    return line ? `${FENCE}${line}\n---\n${markdown}` : markdown;
  }
  const end = markdown.indexOf(`\n${FENCE}`, FENCE.length);
  if (end === -1) {
    // Unterminated fence — not frontmatter as far as the parser is concerned.
    return line ? `${FENCE}${line}\n---\n${markdown}` : markdown;
  }
  const block = markdown.slice(FENCE.length, end + 1);
  const rest = markdown.slice(end + 1);
  const lines = block.split("\n");
  const kept: string[] = [];
  let replaced = false;
  for (let i = 0; i < lines.length; i += 1) {
    const idx = lines[i].indexOf(":");
    if (idx === -1 || lines[i].slice(0, idx).trim() !== FM_TAGGED_SPACES) {
      kept.push(lines[i]);
      continue;
    }
    // Drop the key's own line plus any `  - item` continuation, so a stored
    // block list does not survive alongside the inline form replacing it.
    while (i + 1 < lines.length && /^\s+-\s*/.test(lines[i + 1])) i += 1;
    if (line) kept.push(line);
    replaced = true;
  }
  if (line && !replaced) {
    // Keep the trailing empty element produced by the block's final newline.
    kept.splice(Math.max(kept.length - 1, 0), 0, line);
  }
  return FENCE + kept.join("\n") + rest;
}

/**
 * Carry a page's whole-page tags across an agent rewrite.
 *
 * An ingest regenerates a dynamic page's body from scratch, and the agent
 * composes fresh frontmatter with it — so without this, every tag on a
 * dynamic page would be dropped on the next run, silently and forever. Same
 * rule and the same choke point as the page-kind guard: an agent write may
 * not clear tags a page already carries.
 *
 * Only *additions* pass through. The agent may tag a page it is creating, and
 * may add a space to one it rewrites; it may not remove a tag a person put
 * there, because untagging is a human decision made in the editor.
 */
export function preserveStoredSpaceTags(
  stored: string | null | undefined,
  incoming: string,
): { markdown: string; restored: string[] } {
  if (!stored) return { markdown: incoming, restored: [] };
  const [storedFm] = parseFrontmatter(stored);
  const kept = frontmatterSpaceTags(storedFm);
  if (kept.length === 0) return { markdown: incoming, restored: [] };

  const [incomingFm] = parseFrontmatter(incoming);
  const declared = frontmatterSpaceTags(incomingFm);
  const restored = kept.filter((slug) => !declared.includes(slug));
  if (restored.length === 0) return { markdown: incoming, restored: [] };
  return {
    markdown: withSpaceTags(incoming, [...declared, ...restored]),
    restored,
  };
}

/**
 * How a row should describe what a page says about a space.
 *
 * The surface lists one row per page however many passages carry the tag, so
 * this count is the only place the extra mentions are visible at all.
 */
export function describeSpaceTag(count: SpaceTagCount): string {
  const mentions =
    count.passages === 0
      ? ""
      : count.passages === 1
        ? "1 passage"
        : `${count.passages} passages`;
  if (count.page) return mentions ? `Whole page · ${mentions}` : "Whole page";
  return mentions || "Whole page";
}
