/**
 * Every address the prototype is exported at.
 *
 * A static site has no router: a URL exists only if a file was written for
 * it. The application addresses a space's views through one catch-all
 * segment, so the views have to be enumerated here — once, from the same
 * fixtures the screens read, so that a space added to the fixtures is
 * reachable without anyone remembering to add it twice.
 */

import {
  categorySlug,
  defaultTaxonomy,
  withConfiguredCategories,
} from "@/lib/projects/function-taxonomy";

import { CONFIGURED_CATEGORIES, pagesFor, SPACES } from "./data";

/** The views a space offers that take no further argument. */
const VIEWS: string[][] = [
  [],
  ["wiki"],
  ["related"],
  ["sources"],
  ["glossary"],
  ["meetings"],
  ["gists"],
  ["issues"],
  ["feed"],
  ["insights"],
  ["ingest"],
  ["settings"],
  ["templates"],
  ["standup"],
  ["agent"],
];

export function spaceSlugs(): string[] {
  return SPACES.map((space) => space.slug);
}

export function spaceParams(): { slug: string }[] {
  return spaceSlugs().map((slug) => ({ slug }));
}

export function tomeParams(): { slug: string; path: string[] }[] {
  const params: { slug: string; path: string[] }[] = [];
  for (const slug of spaceSlugs()) {
    for (const view of VIEWS) {
      // The catch-all is optional, but an export still needs a value for it;
      // the empty array is the space's own summary.
      params.push({ slug, path: view });
    }
    for (const page of Object.keys(pagesFor(slug))) {
      const segments = page.split("/");
      params.push({ slug, path: ["wiki", ...segments] });
      params.push({ slug, path: ["history", ...segments] });
    }
  }
  return params;
}

/**
 * Categories are addressed as `<function>--<category>`.
 *
 * Built by the application's own taxonomy functions from the same
 * configuration string the browser is given, and addressed with the
 * application's own `categorySlug`. Reimplementing the id rule here is the
 * one thing that would make the exported addresses and the links the chooser
 * writes disagree, and a link that 404s is exactly what a prototype must not
 * do.
 */
export function categoryParams(): { slug: string }[] {
  const taxonomy = withConfiguredCategories(
    defaultTaxonomy(),
    CONFIGURED_CATEGORIES,
  );
  return taxonomy.functions.flatMap((fn) =>
    fn.categories.map((category) => ({ slug: categorySlug(fn, category) })),
  );
}
