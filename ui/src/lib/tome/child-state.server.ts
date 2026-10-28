// Pages written, last touch, and any ingest in flight, for a set of spaces.
//
// Lives here rather than beside either caller because both the "Areas &
// projects" card on a container and the one on the workspace overview need
// the same four aggregations, and a second copy of them is a second thing to
// keep correct when a collection is renamed.

import { getCollection } from "@/lib/mongodb";

export interface ChildState {
  page_count: number;
  last_ingested_at: string | null;
  last_edited_at: string | null;
  ingesting: "queued" | "running" | null;
}

/**
 * Pages written, last touch, and any ingest in flight, for a set of children.
 *
 * Four scoped aggregations rather than a query per child, matching what the
 * projects list already does. Tome's collections are optional — an install
 * that has never ingested anything has none of them — so a failure here
 * leaves the card without state rather than without children.
 */
export async function stateByProjectId(
  ids: readonly string[],
): Promise<Map<string, ChildState>> {
  const state = new Map<string, ChildState>();
  if (ids.length === 0) return state;

  const blank = (): ChildState => ({
    page_count: 0,
    last_ingested_at: null,
    last_edited_at: null,
    ingesting: null,
  });
  const at = (id: string) => {
    const existing = state.get(id);
    if (existing) return existing;
    const created = blank();
    state.set(id, created);
    return created;
  };

  try {
    const [revisions, runs] = await Promise.all([
      getCollection("tome_page_revisions"),
      getCollection("tome_ingest_runs"),
    ]);
    const [pages, edits, ingests, active] = await Promise.all([
      revisions
        .aggregate([
          { $match: { project_id: { $in: ids }, deleted: { $ne: true } } },
          { $group: { _id: { project_id: "$project_id", path: "$path" } } },
          { $group: { _id: "$_id.project_id", count: { $sum: 1 } } },
        ])
        .toArray(),
      revisions
        .aggregate([
          { $match: { project_id: { $in: ids } } },
          { $group: { _id: "$project_id", at: { $max: "$created_at" } } },
        ])
        .toArray(),
      runs
        .aggregate([
          { $match: { project_id: { $in: ids }, status: "succeeded" } },
          { $group: { _id: "$project_id", at: { $max: "$finished_at" } } },
        ])
        .toArray(),
      runs
        .find({ project_id: { $in: ids }, status: { $in: ["queued", "running"] } })
        .project({ project_id: 1, status: 1 })
        .toArray(),
    ]);

    for (const row of pages) {
      at(String(row._id)).page_count = Number(row.count) || 0;
    }
    for (const row of edits) {
      at(String(row._id)).last_edited_at = iso(row.at);
    }
    for (const row of ingests) {
      at(String(row._id)).last_ingested_at = iso(row.at);
    }
    for (const run of active) {
      const entry = at(String(run.project_id));
      // Running outranks queued: it is the one worth telling a reader about,
      // and a child can have both at once.
      if (entry.ingesting !== "running") {
        entry.ingesting = run.status === "running" ? "running" : "queued";
      }
    }
  } catch {
    // No Tome collections yet. The children are still worth listing.
  }

  return state;
}

export function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value ? value : null;
}
