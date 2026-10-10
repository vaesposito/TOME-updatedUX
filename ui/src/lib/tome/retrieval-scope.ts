/** Current caller-readable catalog used by the isolated retrieval session. */
import { createHash } from "crypto";

import { ApiError } from "@/lib/api-middleware";
import { isTomeAdminSubject, listReadableTomeProjects, resolveTomeParentsFromCatalog } from "./access";
import type { ChildProjectSnapshot } from "./agent-proxy";

export interface TomeRetrievalRestriction {
  type: "bhag" | "area" | "project";
  slug: string;
}

/** Restrict only the already-authorized catalog, including readable descendants. */
export function narrowTomeRetrievalCatalog(
  catalog: ChildProjectSnapshot[],
  restriction?: TomeRetrievalRestriction,
): ChildProjectSnapshot[] {
  if (!restriction) return catalog;
  const root = catalog.find((entry) => entry.slug === restriction.slug && entry.project_type === restriction.type);
  if (!root) throw new ApiError("Requested TOME scope is unavailable", 404, "TOME_SCOPE_UNAVAILABLE");
  const included = new Set([root.slug]);
  if (restriction.type === "bhag") {
    for (const entry of catalog) if (entry.bhags?.includes(root.slug)) included.add(entry.slug);
  }
  if (restriction.type !== "project") {
    const areas = new Set(catalog.filter((entry) => entry.project_type === "area" && included.has(entry.slug)).map((entry) => entry.slug));
    for (const entry of catalog) if (entry.areas?.some((slug) => areas.has(slug))) included.add(entry.slug);
  }
  return catalog.filter((entry) => included.has(entry.slug));
}

export async function buildTomeRetrievalScope(subject: string): Promise<{
  catalog: ChildProjectSnapshot[];
  hash: string;
}> {
  const readable = await listReadableTomeProjects(subject, {
    isAdmin: await isTomeAdminSubject(subject),
  });
  const catalog = readable.map<ChildProjectSnapshot>((project) => {
    const parents = resolveTomeParentsFromCatalog(project, readable);
    return {
      project_id: String(project._id), slug: project.slug, name: project.title || project.name,
      project_type: project.type === "bhag" || project.type === "area" ? project.type : "project",
      bhags: parents.filter((parent) => parent.type === "bhag").map((parent) => parent.slug),
      areas: parents.filter((parent) => parent.type === "area").map((parent) => parent.slug),
    };
  }).sort((a, b) => a.project_id.localeCompare(b.project_id));
  return { catalog, hash: createHash("sha256").update(JSON.stringify(catalog)).digest("hex") };
}
