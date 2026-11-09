// The project's vocabulary: every `glossary/<slug>.md` term entry, read out
// of its frontmatter so the glossary can be shown as a glossary rather than
// as a folder of filenames.

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getPageStore } from "@/lib/tome/page-store";
import {
  FM_ALIASES,
  FM_EXPANSION,
  FM_SCOPE,
  FM_STATUS,
  FM_TERM,
  FM_TERM_KIND,
  isGlossaryTerm,
  parseFrontmatter,
  type FrontmatterValue,
} from "@/lib/tome/schema";
import { loadTomeProject } from "@/lib/tome/tome-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

function str(value: FrontmatterValue | undefined): string {
  return value === undefined || value === null ? "" : String(value);
}

/** Aliases as a list, however they were written: a YAML list or a comma line. */
function aliases(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return str(value)
    .split(",")
    .map((alias) => alias.trim())
    .filter(Boolean);
}

/** The term a page defines, falling back to its filename rather than to nothing. */
function termOf(path: string, frontmatter: Record<string, FrontmatterValue>): string {
  const stated = str(frontmatter[FM_TERM]).trim();
  if (stated) return stated;
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const { projectId } = await loadTomeProject(request, slug);
  const pages = await (await getPageStore()).listPages(projectId);

  const terms = Object.entries(pages)
    .map(([path, markdown]) => {
      const [frontmatter, body] = parseFrontmatter(markdown);
      // Typed by its frontmatter, not by where it sits: a term filed outside
      // the glossary folder is still a term, and a stray note inside it is
      // not one.
      if (!isGlossaryTerm(frontmatter)) return null;
      return {
        path,
        term: termOf(path, frontmatter),
        expansion: str(frontmatter[FM_EXPANSION]).trim() || null,
        aliases: aliases(frontmatter[FM_ALIASES]),
        scope: str(frontmatter[FM_SCOPE]).trim() || null,
        termKind: str(frontmatter[FM_TERM_KIND]).trim() || null,
        status: str(frontmatter[FM_STATUS]).trim() || null,
        definition: body.trim(),
      };
    })
    .filter((term): term is NonNullable<typeof term> => term !== null)
    // Alphabetical, as a glossary is read: by the word, not by when it was
    // written or where the store happened to list it.
    .sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" }));

  return successResponse({ terms });
});
