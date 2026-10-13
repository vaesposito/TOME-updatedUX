import {
  cellText,
  column,
  tableUnder,
  type MarkdownTable,
} from "@/lib/tome/markdown-tables";

/**
 * The facts a project states about itself on its curated pages.
 *
 * Milestones live in the roadmap page's Milestones table and KPIs in the
 * charter's KPIs table, both written from a template that fixes the columns.
 * Reading them back is the only way to show either, since neither is stored
 * as data anywhere.
 *
 * Both templates ship their table empty, so an empty result is the normal
 * state of a project nobody has filled in yet rather than a failure — the
 * widgets that call this say so instead of showing nothing.
 */

/** Where a milestone stands, as the roadmap template enumerates it. */
export type MilestoneStatus =
  | "not_started"
  | "in_progress"
  | "at_risk"
  | "blocked"
  | "done"
  | "unknown";

/**
 * Matched at the start of the cell, which is where the template puts the
 * status; in-progress rows are asked to carry an ETA after it, and a row
 * reading "In progress - ETA Jul'26" is in progress.
 */
const STATUS_PATTERNS: readonly { status: MilestoneStatus; match: RegExp }[] = [
  { status: "done", match: /^(done|complete|completed|shipped|delivered)\b/ },
  { status: "at_risk", match: /^(at risk|at-risk|slipping)\b/ },
  { status: "blocked", match: /^blocked\b/ },
  { status: "in_progress", match: /^(in[\s-]progress|ongoing|started|wip)\b/ },
  { status: "not_started", match: /^(not[\s-]started|planned|upcoming|to[\s-]?do)\b/ },
];

export function milestoneStatus(cell: string): MilestoneStatus {
  const text = cellText(cell).toLowerCase();
  for (const { status, match } of STATUS_PATTERNS) {
    if (match.test(text)) return status;
  }
  return "unknown";
}

export interface RoadmapMilestone {
  title: string;
  /** As written — "Q2 FY26", "Jul'26" — and never parsed into a date. */
  target: string;
  outcome: string;
  /** Market Making or Market Serving, in the template's words. */
  delivery: string;
  owner: string;
  status: MilestoneStatus;
  /** The status cell as written, which may carry an ETA the status drops. */
  statusLabel: string;
}

export interface CharterKpi {
  metric: string;
  baseline: string;
  target: string;
  timeframe: string;
}

/**
 * A row is worth showing once it has been named. The other columns are
 * frequently still blank while a milestone is being agreed, and a named
 * milestone with no owner yet is itself worth seeing.
 */
function named(table: MarkdownTable, row: string[], ...names: string[]): string {
  return column(table, row, ...names);
}

export function parseRoadmapMilestones(markdown: string): RoadmapMilestone[] {
  const table = tableUnder(markdown, "Milestones");
  if (!table) return [];
  return table.rows
    .map((row) => {
      const statusLabel = named(table, row, "status");
      return {
        title: named(table, row, "milestone", "outcome", "name"),
        target: named(table, row, "target", "target date", "date"),
        outcome: named(table, row, "outcome & success signal", "success signal"),
        delivery: named(table, row, "mm/ms", "delivery window"),
        owner: named(table, row, "owner"),
        status: milestoneStatus(statusLabel),
        statusLabel,
      };
    })
    .filter((milestone) => milestone.title !== "");
}

export function parseCharterKpis(markdown: string): CharterKpi[] {
  const table = tableUnder(markdown, "KPIs");
  if (!table) return [];
  return table.rows
    .map((row) => ({
      metric: named(table, row, "metric", "kpi"),
      baseline: named(table, row, "baseline"),
      target: named(table, row, "target"),
      timeframe: named(table, row, "time frame", "timeframe", "period"),
    }))
    .filter((kpi) => kpi.metric !== "");
}

/**
 * The milestones worth putting on a home page, in the page's own order.
 *
 * What has not landed yet comes first: a roadmap is read to find out what is
 * coming. Finished milestones fill any remaining room, so a project that has
 * delivered everything shows its record rather than an empty card.
 */
export function upcomingMilestones(
  milestones: readonly RoadmapMilestone[],
  limit: number,
): RoadmapMilestone[] {
  const live = milestones.filter((milestone) => milestone.status !== "done");
  const done = milestones.filter((milestone) => milestone.status === "done");
  return [...live, ...done].slice(0, limit);
}
