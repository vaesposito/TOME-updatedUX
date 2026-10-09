/** Current caller-readable catalog used by the isolated retrieval session. */
import { createHash } from "crypto";

import { isTomeAdminSubject, listReadableTomeProjects } from "./access";
import type { ChildProjectSnapshot } from "./agent-proxy";

export async function buildTomeRetrievalScope(subject: string): Promise<{
  catalog: ChildProjectSnapshot[];
  hash: string;
}> {
  const readable = await listReadableTomeProjects(subject, {
    isAdmin: await isTomeAdminSubject(subject),
  });
  const catalog = readable.map<ChildProjectSnapshot>((project) => ({
    project_id: String(project._id), slug: project.slug, name: project.title || project.name,
    project_type: project.type === "bhag" || project.type === "area" ? project.type : "project",
    bhags: project.labels?.initiatives ?? [], areas: project.labels?.areas ?? [],
  })).sort((a, b) => a.project_id.localeCompare(b.project_id));
  return { catalog, hash: createHash("sha256").update(JSON.stringify(catalog)).digest("hex") };
}
