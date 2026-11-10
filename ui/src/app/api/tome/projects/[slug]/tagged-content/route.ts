// The content tagged with this space: pages written anywhere else whose
// frontmatter or prose names this space. See lib/tome/space-tags.ts for how a
// tag is stored and lib/tome/space-tags-index.ts for how the tagged side sees
// it without scanning every other space's pages.
//
//   GET /api/tome/projects/[slug]/tagged-content → { items }

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { taggedContentForSpace } from "@/lib/tome/tagged-content.server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  return successResponse({ items: await taggedContentForSpace(tctx) });
});
