/**
 * Settings as five groups rather than eleven tabs in a row.
 *
 * The flat strip grew one tab at a time until no two neighbours had anything
 * to do with each other — "Models" sat between "Sources" and "Auto-ingest",
 * and "Sidebar" was the name for which reports a rail shows. Reading it meant
 * reading all of it.
 *
 * This is a reading of the same tabs, not a rebuild of them: every entry here
 * names a panel that already exists and still renders itself. The group is a
 * heading; the subtab is the tab that was always there. Three of the labels
 * are corrected on the way past, because `organization`, `slt` and `reports`
 * were never what those panels were about.
 */

export interface TomeSettingsSubTab {
  /** The panel this stands for, as it is keyed in the panel's own Tabs. */
  value: string;
  label: string;
  /**
   * Which part of that panel to show, when several subtabs share one.
   *
   * The sources editor autosaves, and it serializes its writes through one
   * chain per instance. Five of them over the same sources object would race
   * each other, so the five connectors are one mounted editor asked for one
   * connector at a time rather than five editors.
   */
  focus?: string;
  /** Only shown for a BHAG or an Area, which contain other spaces. */
  containerOnly?: boolean;
  /** Only shown for a Project, which does not. */
  projectOnly?: boolean;
  /** Only shown when the space can actually read from this source. */
  sourceKind?: "github" | "confluence" | "webex" | "sharepoint" | "myagent";
}

export interface TomeSettingsGroup {
  id: string;
  label: string;
  subtabs: readonly TomeSettingsSubTab[];
  /**
   * Stands in when every connector-specific subtab has been filtered away.
   *
   * A deployment that has configured no sources at all would otherwise lose
   * the panel that says so, and with it the link out to connect one — the
   * group would be left offering only the schedule on which to read nothing.
   */
  fallback?: TomeSettingsSubTab;
}

export const TOME_SETTINGS_GROUPS: readonly TomeSettingsGroup[] = [
  {
    id: "general",
    label: "General",
    subtabs: [
      { value: "general", label: "Project details" },
      { value: "organization", label: "Access config" },
      { value: "models", label: "Models" },
      { value: "projects", label: "Projects", containerOnly: true },
    ],
  },
  {
    // One subtab per connector, which the sources editor already supports:
    // it takes the kinds to draw, so asking it for one is not a new editor.
    id: "sources",
    label: "Sources",
    subtabs: [
      { value: "sources", label: "GitHub", focus: "github", sourceKind: "github" },
      {
        value: "sources",
        label: "Confluence",
        focus: "confluence",
        sourceKind: "confluence",
      },
      { value: "sources", label: "Webex", focus: "webex", sourceKind: "webex" },
      {
        value: "sources",
        label: "SharePoint",
        focus: "sharepoint",
        sourceKind: "sharepoint",
      },
      { value: "sources", label: "MyAgent", focus: "myagent", sourceKind: "myagent" },
      { value: "auto-ingest", label: "Auto-ingest" },
    ],
    fallback: { value: "sources", label: "Connections" },
  },
  {
    id: "content",
    label: "Content",
    subtabs: [
      { value: "pages", label: "Pages" },
      { value: "review", label: "Review" },
      { value: "slt", label: "Metadata" },
    ],
  },
  {
    id: "notifications",
    label: "Notifications",
    subtabs: [
      { value: "notifications", label: "General" },
      { value: "notifications-following", label: "Followed spaces" },
    ],
  },
  {
    id: "ui",
    label: "UI preferences",
    subtabs: [
      { value: "feed", label: "Activity Feed", projectOnly: true },
      { value: "reports", label: "Sidebar" },
    ],
  },
];

/** Which subtabs apply, given what this space is and what it can read. */
export function visibleSubtabs(
  group: TomeSettingsGroup,
  { container, sourceKinds }: { container: boolean; sourceKinds: readonly string[] },
): TomeSettingsSubTab[] {
  const kept = group.subtabs.filter((subtab) => {
    if (subtab.containerOnly && !container) return false;
    if (subtab.projectOnly && container) return false;
    if (subtab.sourceKind && !sourceKinds.includes(subtab.sourceKind)) return false;
    return true;
  });
  const wanted = group.subtabs.some((subtab) => subtab.sourceKind);
  const gotOne = kept.some((subtab) => subtab.sourceKind);
  if (group.fallback && wanted && !gotOne) return [group.fallback, ...kept];
  return kept;
}

/**
 * The group a panel belongs to.
 *
 * Needed because the panel is addressed by `?tab=`, which names a subtab, and
 * a deep link into one has to open the group above it. Links written before
 * this existed still work: `?tab=sources` lands on the first source there is.
 */
export function groupForTab(
  value: string,
): { group: TomeSettingsGroup; subtab: TomeSettingsSubTab } | null {
  for (const group of TOME_SETTINGS_GROUPS) {
    const subtab = group.subtabs.find((entry) => entry.value === value);
    if (subtab) return { group, subtab };
  }
  return null;
}

/** How a subtab is told apart from its siblings that share a panel. */
export function subtabId(subtab: TomeSettingsSubTab): string {
  return subtab.focus ? `${subtab.value}:${subtab.focus}` : subtab.value;
}
