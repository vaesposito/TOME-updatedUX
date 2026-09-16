/** Organization-wide ingestion monitoring, charged to the UTC month a run starts. */
import { getCollection } from "@/lib/mongodb";
import type { IngestRun } from "@/types/tome";
import type { ProjectDocument } from "@/types/projects";

export interface IngestionBudgetSettings {
  monthlyLimitUsd: number | null;
  alertAtPercent: number;
}
interface BudgetDocument extends IngestionBudgetSettings {
  _id: string;
  updatedAt: Date;
  updatedBy: string;
}
export interface BudgetRunRow {
  _id: { projectId: string; synthesis: boolean };
  runs: number;
  measuredRuns: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  pendingRuns: number;
}
export interface IngestionBudgetAnalytics extends IngestionBudgetSettings {
  month: string;
  periodStart: string;
  periodEnd: string;
  asOf: string;
  spentUsd: number;
  remainingUsd: number | null;
  utilizationPercent: number | null;
  status: "not_configured" | "within_budget" | "near_limit" | "over_budget";
  runs: number;
  measuredRuns: number;
  unmeasuredRuns: number;
  pendingRuns: number;
  inputTokens: number;
  outputTokens: number;
  byEntity: Array<{
    projectId: string;
    name: string;
    slug: string | null;
    type: string;
    ingestionUsd: number;
    synthesisUsd: number;
    measuredRuns: number;
    runs: number;
  }>;
}
const DEFAULT_SETTINGS: IngestionBudgetSettings = {
  monthlyLimitUsd: null,
  alertAtPercent: 80,
};

export function validateBudgetSettings(
  value: unknown,
): IngestionBudgetSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Budget settings must be an object.");
  const { monthlyLimitUsd, alertAtPercent } = value as IngestionBudgetSettings;
  if (
    monthlyLimitUsd !== null &&
    (typeof monthlyLimitUsd !== "number" ||
      !Number.isFinite(monthlyLimitUsd) ||
      monthlyLimitUsd <= 0 ||
      monthlyLimitUsd > 1_000_000_000 ||
      Math.abs(monthlyLimitUsd * 100 - Math.round(monthlyLimitUsd * 100)) >
        0.0001)
  ) {
    throw new Error(
      "Monthly budget must be a positive USD amount with at most two decimal places, or null to remove it.",
    );
  }
  if (
    !Number.isInteger(alertAtPercent) ||
    alertAtPercent < 1 ||
    alertAtPercent > 100
  )
    throw new Error(
      "Warning threshold must be a whole percentage from 1 to 100.",
    );
  return { monthlyLimitUsd, alertAtPercent };
}

export async function saveIngestionBudget(
  value: IngestionBudgetSettings,
  actor: string,
): Promise<void> {
  const settings = validateBudgetSettings(value);
  const collection = await getCollection<BudgetDocument>("tome_budget_config");
  await collection.updateOne(
    { _id: "global" },
    { $set: { ...settings, updatedAt: new Date(), updatedBy: actor } },
    { upsert: true },
  );
}

export function summarizeIngestionBudget(
  settings: IngestionBudgetSettings,
  rows: BudgetRunRow[],
  projects: Array<{ id: string; name: string; slug: string; type: string }>,
  now: Date,
): IngestionBudgetAnalytics {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const totals = rows.reduce(
    (result, row) => ({
      runs: result.runs + row.runs,
      measuredRuns: result.measuredRuns + row.measuredRuns,
      spentUsd: result.spentUsd + row.costUsd,
      pendingRuns: result.pendingRuns + row.pendingRuns,
      inputTokens: result.inputTokens + row.inputTokens,
      outputTokens: result.outputTokens + row.outputTokens,
    }),
    {
      runs: 0,
      measuredRuns: 0,
      spentUsd: 0,
      pendingRuns: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
  );
  const projectsById = new Map(
    projects.map((project) => [project.id, project]),
  );
  const byEntity = new Map<
    string,
    IngestionBudgetAnalytics["byEntity"][number]
  >();
  for (const row of rows) {
    const project = projectsById.get(row._id.projectId);
    const current = byEntity.get(row._id.projectId) ?? {
      projectId: row._id.projectId,
      name: project?.name ?? "Removed entity",
      slug: project?.slug ?? null,
      type: project?.type ?? "removed",
      ingestionUsd: 0,
      synthesisUsd: 0,
      runs: 0,
      measuredRuns: 0,
    };
    if (row._id.synthesis) current.synthesisUsd += row.costUsd;
    else current.ingestionUsd += row.costUsd;
    current.runs += row.runs;
    current.measuredRuns += row.measuredRuns;
    byEntity.set(row._id.projectId, current);
  }
  const limit = settings.monthlyLimitUsd;
  const utilizationPercent =
    limit === null ? null : (totals.spentUsd / limit) * 100;
  return {
    ...settings,
    ...totals,
    month: start.toISOString().slice(0, 7),
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    asOf: now.toISOString(),
    remainingUsd: limit === null ? null : Math.max(0, limit - totals.spentUsd),
    utilizationPercent,
    status:
      limit === null
        ? "not_configured"
        : totals.spentUsd >= limit
          ? "over_budget"
          : utilizationPercent! >= settings.alertAtPercent
            ? "near_limit"
            : "within_budget",
    unmeasuredRuns: totals.runs - totals.measuredRuns,
    byEntity: [...byEntity.values()].sort(
      (a, b) =>
        b.ingestionUsd + b.synthesisUsd - (a.ingestionUsd + a.synthesisUsd),
    ),
  };
}

export async function getIngestionBudget(
  now = new Date(),
): Promise<IngestionBudgetAnalytics> {
  const [configs, runs, projects] = await Promise.all([
    getCollection<BudgetDocument>("tome_budget_config"),
    getCollection<IngestRun>("tome_ingest_runs"),
    getCollection<ProjectDocument>("projects"),
  ]);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const validCost = {
    $and: [{ $isNumber: "$cost_usd" }, { $gte: ["$cost_usd", 0] }],
  };
  const [config, rows, projectRows] = await Promise.all([
    configs.findOne({ _id: "global" }, { maxTimeMS: 15_000 }),
    runs
      .aggregate<BudgetRunRow>(
        [
          { $match: { started_at: { $gte: start, $lte: now } } },
          {
            $group: {
              _id: {
                projectId: "$project_id",
                synthesis: { $eq: ["$dispatch.endpoint", "/synthesize"] },
              },
              runs: { $sum: 1 },
              measuredRuns: { $sum: { $cond: [validCost, 1, 0] } },
              costUsd: { $sum: { $cond: [validCost, "$cost_usd", 0] } },
              inputTokens: { $sum: "$usage.input" },
              outputTokens: { $sum: "$usage.output" },
              pendingRuns: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        "$status",
                        ["queued", "running", "awaiting_review"],
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
        { maxTimeMS: 15_000 },
      )
      .toArray(),
    projects
      .find(
        {},
        { projection: { name: 1, slug: 1, type: 1 }, maxTimeMS: 15_000 },
      )
      .toArray(),
  ]);
  return summarizeIngestionBudget(
    config ? validateBudgetSettings(config) : DEFAULT_SETTINGS,
    rows,
    projectRows.map((project) => ({
      id: String(project._id),
      name: project.name || project.slug,
      slug: project.slug,
      type: project.type ?? "project",
    })),
    now,
  );
}
