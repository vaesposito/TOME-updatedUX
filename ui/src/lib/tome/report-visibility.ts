import type { ProjectDocument, TomeReportVisibility } from "@/types/projects";

export const DEFAULT_TOME_REPORT_VISIBILITY: TomeReportVisibility = {
  enabled: true,
  standup: true,
  issues: true,
};

/**
 * Older projects have no report-visibility field. Treat every report as
 * visible until a data steward stores an explicit project preference.
 */
export function resolveTomeReportVisibility(
  project: Pick<ProjectDocument, "report_visibility"> | null | undefined,
): TomeReportVisibility {
  return {
    enabled: project?.report_visibility?.enabled !== false,
    standup: project?.report_visibility?.standup !== false,
    issues: project?.report_visibility?.issues !== false,
  };
}
