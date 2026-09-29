// Internal agent callback: read a project's gists. Agent-token gated, same
// pattern as the pages/snapshot internal endpoints — the chat agent has no
// other way to see gists (they're deliberately kept out of ingest/agent
// context by default, discoverable only via the Feed, MCP, or now here).
//
//   GET /api/tome/api/internal/projects/[id]/gists           → { gists }
//   GET /api/tome/api/internal/projects/[id]/gists?id=<gist> → { gist }

import { NextRequest } from "next/server";

import { withErrorHandler } from "@/lib/api-middleware";
import { requireAgentToken, resolveProject } from "@/lib/tome/internal-api";
import { getTomeGistsCollection } from "@/lib/tome/mongo-collections";
import { defaultGistFilename } from "@/lib/tome/gists";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "because", "been", "before",
  "being", "between", "could", "does", "doing", "from", "have", "into", "just",
  "more", "most", "other", "over", "same", "some", "such", "than", "that",
  "their", "them", "then", "there", "these", "they", "this", "those", "through",
  "under", "very", "what", "when", "where", "which", "while", "with", "would",
]);

function terms(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? [])]
    .filter((term) => !STOP_WORDS.has(term));
}

function excerpt(body: string, queryTerms: string[], maxLength = 500): string {
  const lower = body.toLowerCase();
  const firstMatch = queryTerms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const start = firstMatch === undefined ? 0 : Math.max(0, firstMatch - 120);
  const end = Math.min(body.length, start + maxLength);
  return `${start > 0 ? "…" : ""}${body.slice(start, end).trim()}${end < body.length ? "…" : ""}`;
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  requireAgentToken(request);
  const { id } = await ctx.params;
  const project = await resolveProject(id);

  const gistId = request.nextUrl.searchParams.get("id");
  const query = request.nextUrl.searchParams.get("q")?.trim();
  const gists = await getTomeGistsCollection();

  if (gistId) {
    const g = await gists.findOne({ _id: gistId, project_id: project._id });
    if (!g) return Response.json({ gist: null });
    return Response.json({
      gist: {
        id: String(g._id),
        title: g.title,
        filename: g.filename ?? defaultGistFilename(g.title),
        body: g.body,
        author: g.author,
        created_at: g.created_at,
        updated_at: g.updated_at,
        updated_by: g.updated_by,
        tags: g.tags ?? [],
      },
    });
  }

  if (query) {
    const queryTerms = terms(query);
    if (!queryTerms.length) return Response.json({ gists: [] });

    // Gists remain outside the wiki and ingest pipeline. Search a bounded,
    // recent project-scoped set and return snippets instead of full bodies.
    const candidates = await gists
      .find({ project_id: project._id })
      .sort({ updated_at: -1 })
      .limit(100)
      .toArray();
    const ranked = candidates
      .map((g) => {
        const title = g.title ?? "";
        const tags = (g.tags ?? []).join(" ");
        const body = g.body ?? "";
        const titleTerms = new Set(terms(title));
        const tagTerms = new Set(terms(tags));
        const bodyTerms = new Set(terms(body));
        const score = queryTerms.reduce(
          (total, term) => total + (titleTerms.has(term) ? 5 : 0)
            + (tagTerms.has(term) ? 3 : 0) + (bodyTerms.has(term) ? 1 : 0),
          0,
        );
        return { g, body, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);
    const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? 3);
    const resultLimit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(5, Math.floor(requestedLimit)))
      : 3;

    return Response.json({
      gists: ranked.slice(0, resultLimit).map(({ g, body, score }) => ({
        id: String(g._id),
        title: g.title,
        author: g.author,
        updated_at: g.updated_at,
        tags: g.tags ?? [],
        excerpt: excerpt(body, queryTerms),
        score,
      })),
    });
  }

  const rows = await gists
    .find({ project_id: project._id })
    .sort({ created_at: -1 })
    .toArray();
  return Response.json({
    gists: rows.map((g) => ({
      id: String(g._id),
      title: g.title,
      filename: g.filename ?? defaultGistFilename(g.title),
      author: g.author,
      created_at: g.created_at,
      updated_at: g.updated_at,
      updated_by: g.updated_by,
      tags: g.tags ?? [],
    })),
  });
});
