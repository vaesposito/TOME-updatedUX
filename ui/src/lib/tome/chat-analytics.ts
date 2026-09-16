/** Prompt-based activity. Scheduled ingestion never counts as human adoption. */
import { getCollection } from "@/lib/mongodb";
import type { ProjectDocument } from "@/types/projects";

export const ACTIVITY_PERIODS = ["day", "week", "month"] as const;
export type ActivityPeriod = (typeof ACTIVITY_PERIODS)[number];
export type AnalyticsEntityType = "project" | "area" | "bhag";
export interface ChatActivity {
  users: number;
  prompts: number;
}
export interface ChatEntity {
  id: string;
  slug: string;
  name: string;
  type: AnalyticsEntityType;
  activity: Record<ActivityPeriod, ChatActivity>;
  lastPromptAt: string | null;
}
export interface TomeChatAnalytics {
  asOf: string;
  periods: Record<
    ActivityPeriod,
    ChatActivity & { activeEntities: Record<AnalyticsEntityType, number> }
  >;
  totals: Record<AnalyticsEntityType, number>;
  entities: ChatEntity[];
  daily: Array<{ date: string; users: number; prompts: number }>;
}
export interface ChatActivityRow {
  _id: { projectId: string; userId: string };
  day: number;
  week: number;
  month: number;
  lastAt: Date;
}
type EntityInput = Pick<ChatEntity, "id" | "slug" | "name" | "type">;
const emptyActivity = (): Record<ActivityPeriod, ChatActivity> => ({
  day: { users: 0, prompts: 0 },
  week: { users: 0, prompts: 0 },
  month: { users: 0, prompts: 0 },
});

export function summarizeChatActivity(
  projects: EntityInput[],
  rows: ChatActivityRow[],
  daily: TomeChatAnalytics["daily"],
  now: Date,
): TomeChatAnalytics {
  const entities = projects.map((project) => ({
    ...project,
    activity: emptyActivity(),
    lastPromptAt: null as string | null,
  }));
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const users = {
    day: new Set<string>(),
    week: new Set<string>(),
    month: new Set<string>(),
  };
  const periods = Object.fromEntries(
    ACTIVITY_PERIODS.map((period) => [
      period,
      {
        users: 0,
        prompts: 0,
        activeEntities: { project: 0, area: 0, bhag: 0 },
      },
    ]),
  ) as TomeChatAnalytics["periods"];
  for (const row of rows) {
    const entity = byId.get(row._id.projectId);
    if (!entity || !row._id.userId) continue;
    const lastAt = row.lastAt.toISOString();
    if (!entity.lastPromptAt || lastAt > entity.lastPromptAt)
      entity.lastPromptAt = lastAt;
    for (const period of ACTIVITY_PERIODS) {
      if (row[period] <= 0) continue;
      users[period].add(row._id.userId);
      entity.activity[period].users += 1;
      entity.activity[period].prompts += row[period];
      periods[period].prompts += row[period];
    }
  }
  const totals = { project: 0, area: 0, bhag: 0 };
  for (const entity of entities) {
    totals[entity.type] += 1;
    for (const period of ACTIVITY_PERIODS) {
      if (entity.activity[period].prompts > 0)
        periods[period].activeEntities[entity.type] += 1;
    }
  }
  for (const period of ACTIVITY_PERIODS)
    periods[period].users = users[period].size;
  return { asOf: now.toISOString(), periods, totals, entities, daily };
}

export async function getTomeChatAnalytics(
  now = new Date(),
): Promise<TomeChatAnalytics> {
  const dayMs = 86_400_000;
  const projects = await getCollection<ProjectDocument>("projects");
  const messages = await getCollection("tome_chat_messages");
  const projectRows = await projects
    .find(
      { status: { $ne: "archived" } },
      {
        projection: { slug: 1, name: 1, type: 1 },
        maxTimeMS: 15_000,
      },
    )
    .toArray();
  const entities: EntityInput[] = projectRows.map((project) => ({
    id: String(project._id),
    slug: project.slug,
    name: project.name || project.slug,
    type:
      project.type === "area" || project.type === "bhag"
        ? project.type
        : "project",
  }));
  const match = {
    role: "user",
    project_id: { $in: entities.map((entity) => entity.id) },
    created_at: { $gte: new Date(now.getTime() - 30 * dayMs), $lte: now },
  };
  const join = [
    {
      $lookup: {
        from: "tome_chat_sessions",
        localField: "session_id",
        foreignField: "_id",
        as: "session",
      },
    },
    { $unwind: "$session" },
    { $match: { "session.user_id": { $type: "string", $nin: [""] } } },
  ];
  const [rows, dailyRows] = await Promise.all([
    messages
      .aggregate<ChatActivityRow>(
        [
          { $match: match },
          ...join,
          {
            $group: {
              _id: { projectId: "$project_id", userId: "$session.user_id" },
              day: {
                $sum: {
                  $cond: [
                    { $gte: ["$created_at", new Date(now.getTime() - dayMs)] },
                    1,
                    0,
                  ],
                },
              },
              week: {
                $sum: {
                  $cond: [
                    {
                      $gte: [
                        "$created_at",
                        new Date(now.getTime() - 7 * dayMs),
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              month: { $sum: 1 },
              lastAt: { $max: "$created_at" },
            },
          },
        ],
        { maxTimeMS: 15_000 },
      )
      .toArray(),
    messages
      .aggregate<{
        _id: string;
        users: number;
        prompts: number;
      }>([{ $match: match }, ...join, { $group: { _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } }, user: "$session.user_id" }, prompts: { $sum: 1 } } }, { $group: { _id: "$_id.date", users: { $sum: 1 }, prompts: { $sum: "$prompts" } } }], { maxTimeMS: 15_000 })
      .toArray(),
  ]);
  const byDate = new Map(dailyRows.map((row) => [row._id, row]));
  const daily = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(now.getTime() - (29 - index) * dayMs)
      .toISOString()
      .slice(0, 10);
    const row = byDate.get(date);
    return { date, users: row?.users ?? 0, prompts: row?.prompts ?? 0 };
  });
  return summarizeChatActivity(entities, rows, daily, now);
}
