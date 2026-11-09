// What a container's roll-up cards need to know about one space below it.
//
// A BHAG or an Area has almost nothing of its own: the repositories, the
// rooms and the people are all on the projects underneath. So its Sources and
// People cards are roll-ups, and the facts they roll up ride along with the
// rows the "Areas & projects" card already asks for.
//
// One reader for both routes that serve those rows — a container's children
// and the whole readable workspace — so the two altitudes can never disagree
// on what a space reads from or who answers for it.

import { dataStewardLabel, type ProjectDocument } from "@/types/projects";

export interface ChildRollupFacts {
  sources?: Record<string, unknown>;
  steward?: string;
  owner?: string;
  team?: { slug: string; name: string };
}

/**
 * Facts omitted rather than nulled when a space has none.
 *
 * The cards count what they are given, and an absent key and an empty one
 * read the same to them while costing less to send for a portfolio whose
 * projects mostly have no steward yet.
 */
export function childRollupFacts(
  project: ProjectDocument | undefined,
): ChildRollupFacts {
  if (!project) return {};
  const steward = dataStewardLabel(project.data_steward);
  return {
    ...(project.sources
      ? { sources: project.sources as Record<string, unknown> }
      : {}),
    ...(steward ? { steward } : {}),
    ...(project.owner_id ? { owner: project.owner_id } : {}),
    ...(project.team_slug
      ? {
          team: {
            slug: project.team_slug,
            name: project.team_name || project.team_slug,
          },
        }
      : {}),
  };
}
