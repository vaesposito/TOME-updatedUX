/**
 * Greenfield wiki seeding.
 *
 * A new space is seeded with the one agent-written page the default template
 * carries, and the space's description leads it so the page says something
 * before the first ingest has run. Where a template still includes the older
 * stable pages, they seed with their scaffolds and stay human-edited.
 *
 * Server-only.
 */

import {
  EMPTY_PAGE_PLACEHOLDER,
  MEMORY_SEED,
  pageWithFrontmatter,
} from "./schema";
import { getPageStore } from "./page-store";
import { getPageTemplate } from "./page-templates-store";

/** Select only founding templates whose live page does not already exist. */
export function missingPageTemplates(
  templates: Record<string, string>,
  existing: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(templates).filter(([path]) => !(path in existing)),
  );
}

/**
 * Build the initial `{path: markdown}` for a fresh project from the live
 * top-level template config (admin-editable; falls back to the hardcoded
 * defaults, which are one agent-written overview and the hidden memory
 * page). Stable/hidden pages seed with their configured body scaffold;
 * dynamic/report pages seed with their guidance, or as empty placeholders
 * the ingest agent fills.
 *
 * @param description CAIPE `project.description`, leading the overview.
 */
export async function buildGreenfieldPages(
  description: string,
): Promise<Record<string, string>> {
  const template = await getPageTemplate("top-level");
  const pages: Record<string, string> = {};

  for (const spec of template.pages) {
    if (spec.enabled === false) continue; // templating off for this page
    // Every page seeds with its configured body (stable scaffolds, the memory
    // page, or a dynamic/report guidance comment); pages without one seed as an
    // empty placeholder the ingest agent fills.
    const bodyText = spec.body ?? (spec.kind === "hidden" ? MEMORY_SEED : EMPTY_PAGE_PLACEHOLDER);
    // The description is what the space's own people wrote about it, and on
    // the overview it is the whole of the page until an ingest has run.
    // Above the guidance comment rather than inside it, so it is what a
    // reader sees and what the agent writes around.
    const lead =
      spec.path === "overview.md" && description.trim()
        ? `${description.trim()}\n\n${bodyText}`
        : bodyText;
    let body = pageWithFrontmatter(spec, lead);
    // Older templates still carry a charter, which takes the description in
    // its own intro section instead.
    if (spec.path === "charter.md" && description.trim()) {
      body = injectCharterIntro(body, description.trim());
    }
    pages[spec.path] = body;
  }
  return pages;
}

/**
 * Insert the project description as a lead paragraph directly under the
 * charter's first `## What we're building` heading, replacing the italic
 * prompt line beneath it.
 */
export function injectCharterIntro(charterMd: string, description: string): string {
  const heading = "## What we're building";
  const idx = charterMd.indexOf(heading);
  if (idx === -1) return charterMd;
  const afterHeading = idx + heading.length;
  const rest = charterMd.slice(afterHeading);
  // Drop a leading blank line + the placeholder italic prompt line, if present.
  const cleaned = rest.replace(/^\n+_[^\n]*_\n/, "\n");
  return `${charterMd.slice(0, afterHeading)}\n${description}\n${cleaned}`;
}

/**
 * Seed a project's wiki if it has no pages yet. Returns the number of pages
 * written (0 if the project was already seeded). Idempotent.
 */
export async function seedGreenfieldIfEmpty(
  projectId: string,
  description: string,
  author = "tome-seed",
): Promise<number> {
  const store = await getPageStore();
  const existing = await store.listPages(projectId);
  if (Object.keys(existing).length > 0) return 0;
  const pages = await buildGreenfieldPages(description);
  await store.writePages(projectId, pages, {
    message: "seed: greenfield wiki",
    author,
    origin: "template",
  });
  return Object.keys(pages).length;
}
