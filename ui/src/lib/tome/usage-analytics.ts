/** Aggregate-only Tome product usage, content, and workflow analytics. */

import { getCollection } from "@/lib/mongodb";
import { hashTomeSubject } from "@/lib/tome/audit";
import { getTomeChatMessagesCollection, getTomeUsageEventsCollection } from "@/lib/tome/mongo-collections";
import { TEMPLATE_SCOPES, type TemplateScope } from "@/lib/tome/page-templates-store";
import { FM_TEMPLATE_SCOPE, parseFrontmatter } from "@/lib/tome/schema";
import type { IngestRun, PageRevision } from "@/types/tome";
import type { ProjectDocument } from "@/types/projects";
import type { User } from "@/types/mongodb";

const DAY_MS = 24 * 60 * 60 * 1000;
const ANALYTICS_PROJECT_MATCH = { status: { $ne: "archived" as const } };

export interface TomeUsageAnalytics {
  windowDays: number;
  tracking: {
    startedAt: Date | null;
    coverageDays: number;
    fullWindow: boolean;
  };
  reach: {
    dailyUsers: number;
    weeklyUsers: number;
    monthlyUsers: number;
    returningUsers: number;
    sessions: number;
    views: number;
  };
  pages: {
    views: number;
    uniqueViewers: number;
    top: Array<{
      projectId: string;
      projectSlug: string;
      pagePath: string;
      views: number;
      uniqueViewers: number;
      lastViewedAt: Date;
    }>;
  };
  chat: {
    viewers: number;
    engagedUsers: number;
    prompts: number;
  };
  templates: {
    boundPages: number;
    unboundPages: number;
    projectsUsingTemplates: number;
    views: number;
    byScope: Array<{ scope: TemplateScope; pages: number; projects: number; views: number }>;
  };
  revisionSources: Array<{ origin: string; revisions: number }>;
  manualEdits: { revisions: number; editors: number; pages: number; projects: number };
  ingestion: {
    runs: number;
    succeeded: number;
    failed: number;
    rejected: number;
    pending: number;
    successRate: number | null;
  };
  drafts: {
    sentToReview: number;
    pending: number;
    approved: number;
    rejected: number;
    autoPromoted: number;
    approvalRate: number | null;
  };
  daily: Array<{
    date: string;
    activeUsers: number | null;
    tomeUsers: number | null;
    pageViews: number;
    chatViewers: number | null;
    chatUsers: number;
    prompts: number;
  }>;
}

export interface TomeUsageSubjectRow {
  subjectHash: string;
  lastAt: Date;
  days: string[];
  sessions: string[];
  views: number;
  chatViewed: boolean;
}

export interface TomePageViewRow {
  projectId: string;
  projectSlug: string;
  pagePath: string;
  views: number;
  viewerIds: string[];
  lastViewedAt: Date;
}

export interface TomeDailyViewRow {
  date: string;
  subjectHashes: string[];
  pageViews: number;
  chatViewers: number;
}

export interface TomeChatDayRow {
  date: string;
  subjectHash: string;
  prompts: number;
}

export interface TomeCurrentPageRow {
  projectId: string;
  path: string;
  markdown?: string;
  templateScope?: string | null;
}

export interface TomeManualEditRow {
  editor: string;
  projectId: string;
  path: string;
  revisions: number;
}

export interface TomeUsageRunRow {
  status: IngestRun["status"];
  startedAt: Date;
  finishedAt?: Date;
  reviewedAt?: Date;
  reviewOutcome?: IngestRun["review_outcome"];
  endpoint?: string;
}

export interface TomeUsageSummaryInput {
  trackingStartedAt?: Date | null;
  subjects: TomeUsageSubjectRow[];
  pageViews: TomePageViewRow[];
  dailyViews: TomeDailyViewRow[];
  chatDays: TomeChatDayRow[];
  currentPages: TomeCurrentPageRow[];
  manualEdits: TomeManualEditRow[];
  runs: TomeUsageRunRow[];
  revisionSources?: Array<{ origin: string; revisions: number }>;
}

function dailyBuckets(days: number, now: Date): string[] {
  const buckets: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    buckets.push(new Date(now.getTime() - i * DAY_MS).toISOString().slice(0, 10));
  }
  return buckets;
}

function templateScopeOf(page: TomeCurrentPageRow): TemplateScope | null {
  let value = page.templateScope;
  if (value === undefined && page.markdown) {
    const [frontmatter] = parseFrontmatter(page.markdown);
    value = frontmatter[FM_TEMPLATE_SCOPE] as string | null | undefined;
  }
  return typeof value === "string" && (TEMPLATE_SCOPES as readonly string[]).includes(value)
    ? (value as TemplateScope)
    : null;
}

export function summarizeTomeUsageAnalytics(
  input: TomeUsageSummaryInput,
  now = new Date(),
  windowDays = 30,
): TomeUsageAnalytics {
  const dailyCutoff = new Date(now.getTime() - DAY_MS);
  const weeklyCutoff = new Date(now.getTime() - 7 * DAY_MS);
  const windowCutoff = new Date(now.getTime() - windowDays * DAY_MS);
  const trackingStartedAt = input.trackingStartedAt ?? null;
  const trackingStartDate = trackingStartedAt?.toISOString().slice(0, 10) ?? null;
  const trackingCoverageDays = trackingStartedAt
    ? Math.min(windowDays, Math.max(1, Math.floor((now.getTime() - trackingStartedAt.getTime()) / DAY_MS) + 1))
    : 0;
  const sessions = new Set(input.subjects.flatMap((row) => row.sessions));
  const allPageViewers = new Set(input.pageViews.flatMap((row) => row.viewerIds));
  const chatViewers = input.subjects.filter((row) => row.chatViewed).length;
  const chatUsers = new Set(input.chatDays.map((row) => row.subjectHash));
  const prompts = input.chatDays.reduce((total, row) => total + row.prompts, 0);

  const pageScopes = new Map<string, TemplateScope>();
  const scopeProjects = new Map<TemplateScope, Set<string>>();
  const scopePages = new Map<TemplateScope, number>();
  const scopeViews = new Map<TemplateScope, number>();
  const templatedProjects = new Set<string>();
  let boundPages = 0;
  let unboundPages = 0;
  for (const page of input.currentPages) {
    const scope = templateScopeOf(page);
    if (!scope) {
      unboundPages += 1;
      continue;
    }
    boundPages += 1;
    templatedProjects.add(page.projectId);
    pageScopes.set(`${page.projectId}:${page.path}`, scope);
    scopePages.set(scope, (scopePages.get(scope) ?? 0) + 1);
    const projects = scopeProjects.get(scope) ?? new Set<string>();
    projects.add(page.projectId);
    scopeProjects.set(scope, projects);
  }
  for (const page of input.pageViews) {
    const scope = pageScopes.get(`${page.projectId}:${page.pagePath}`);
    if (scope) scopeViews.set(scope, (scopeViews.get(scope) ?? 0) + page.views);
  }

  const sourceRuns = input.runs.filter((run) => run.endpoint !== "/synthesize");
  const windowRuns = sourceRuns.filter((run) => run.startedAt >= windowCutoff);
  const succeeded = windowRuns.filter((run) => run.status === "succeeded").length;
  const failed = windowRuns.filter((run) => run.status === "failed" && run.reviewOutcome !== "rejected").length;
  const rejectedRuns = windowRuns.filter((run) => run.status === "failed" && run.reviewOutcome === "rejected").length;
  const pending = sourceRuns.filter((run) => run.status === "awaiting_review").length;
  const reviewedInWindow = sourceRuns.filter((run) => {
    const completedAt = run.reviewedAt ?? run.finishedAt;
    return Boolean(run.reviewOutcome && completedAt && completedAt >= windowCutoff);
  });
  const approved = reviewedInWindow.filter((run) => run.reviewOutcome === "approved").length;
  const rejected = reviewedInWindow.filter((run) => run.reviewOutcome === "rejected").length;
  const autoPromoted = reviewedInWindow.filter((run) => run.reviewOutcome === "auto_promoted").length;
  const sentToReview = reviewedInWindow.length + windowRuns.filter((run) => run.status === "awaiting_review").length;

  const daily = new Map<string, TomeUsageAnalytics["daily"][number]>(
    dailyBuckets(windowDays, now).map((date) => [
      date,
      {
        date,
        activeUsers: trackingStartDate && date >= trackingStartDate ? 0 : null,
        tomeUsers: trackingStartDate && date >= trackingStartDate ? 0 : null,
        pageViews: 0,
        chatViewers: trackingStartDate && date >= trackingStartDate ? 0 : null,
        chatUsers: 0,
        prompts: 0,
      },
    ]),
  );
  const dailyActiveSubjects = new Map<string, Set<string>>();
  for (const row of input.dailyViews) {
    const bucket = daily.get(row.date);
    if (bucket) Object.assign(bucket, {
      tomeUsers: row.subjectHashes.length,
      pageViews: row.pageViews,
      chatViewers: row.chatViewers,
    });
    dailyActiveSubjects.set(row.date, new Set(row.subjectHashes));
  }
  for (const row of input.chatDays) {
    const bucket = daily.get(row.date);
    if (bucket) {
      bucket.chatUsers += 1;
      bucket.prompts += row.prompts;
      if (bucket.activeUsers !== null) {
        const activeSubjects = dailyActiveSubjects.get(row.date) ?? new Set<string>();
        activeSubjects.add(row.subjectHash);
        dailyActiveSubjects.set(row.date, activeSubjects);
      }
    }
  }
  for (const [date, bucket] of daily) {
    if (bucket.activeUsers !== null) {
      bucket.activeUsers = dailyActiveSubjects.get(date)?.size ?? 0;
    }
  }

  const manualEditors = new Set(input.manualEdits.map((row) => row.editor));
  const manuallyEditedPages = new Set(input.manualEdits.map((row) => `${row.projectId}:${row.path}`));
  const manuallyEditedProjects = new Set(input.manualEdits.map((row) => row.projectId));

  const revisionSources = (input.revisionSources ?? []).map((row) => ({ ...row }));
  const legacy = revisionSources.find((row) => row.origin === "legacy");
  const manual = revisionSources.find((row) => row.origin === "manual");
  const legacyManual = Math.max(0, input.manualEdits.reduce((total, row) => total + row.revisions, 0) - (manual?.revisions ?? 0));
  if (legacy && legacyManual > 0) {
    const recovered = Math.min(legacy.revisions, legacyManual);
    legacy.revisions -= recovered;
    if (manual) manual.revisions += recovered;
    else revisionSources.push({ origin: "manual", revisions: recovered });
  }
  return {
    revisionSources: revisionSources.filter((row) => row.revisions > 0),
    windowDays,
    tracking: {
      startedAt: trackingStartedAt,
      coverageDays: trackingCoverageDays,
      fullWindow: Boolean(trackingStartedAt && trackingStartedAt <= windowCutoff),
    },
    reach: {
      dailyUsers: input.subjects.filter((row) => row.lastAt >= dailyCutoff).length,
      weeklyUsers: input.subjects.filter((row) => row.lastAt >= weeklyCutoff).length,
      monthlyUsers: input.subjects.length,
      returningUsers: input.subjects.filter((row) => row.days.length >= 2).length,
      sessions: sessions.size,
      views: input.subjects.reduce((total, row) => total + row.views, 0),
    },
    pages: {
      views: input.pageViews.reduce((total, row) => total + row.views, 0),
      uniqueViewers: allPageViewers.size,
      top: [...input.pageViews]
        .sort((left, right) => right.views - left.views || right.viewerIds.length - left.viewerIds.length)
        .slice(0, 10)
        .map(({ viewerIds, ...row }) => ({ ...row, uniqueViewers: viewerIds.length })),
    },
    chat: {
      viewers: chatViewers,
      engagedUsers: chatUsers.size,
      prompts,
    },
    templates: {
      boundPages,
      unboundPages,
      projectsUsingTemplates: templatedProjects.size,
      views: [...scopeViews.values()].reduce((total, value) => total + value, 0),
      byScope: TEMPLATE_SCOPES.map((scope) => ({
        scope,
        pages: scopePages.get(scope) ?? 0,
        projects: scopeProjects.get(scope)?.size ?? 0,
        views: scopeViews.get(scope) ?? 0,
      })),
    },
    manualEdits: {
      revisions: input.manualEdits.reduce((total, row) => total + row.revisions, 0),
      editors: manualEditors.size,
      pages: manuallyEditedPages.size,
      projects: manuallyEditedProjects.size,
    },
    ingestion: {
      runs: windowRuns.length,
      succeeded,
      failed,
      rejected: rejectedRuns,
      pending,
      successRate: succeeded + rejectedRuns + failed > 0 ? (succeeded + rejectedRuns) / (succeeded + rejectedRuns + failed) : null,
    },
    drafts: {
      sentToReview,
      pending,
      approved,
      rejected,
      autoPromoted,
      approvalRate: approved + rejected > 0 ? approved / (approved + rejected) : null,
    },
    daily: [...daily.values()],
  };
}

function emptyUsage(windowDays: number): TomeUsageAnalytics {
  return summarizeTomeUsageAnalytics(
    { trackingStartedAt: null, subjects: [], pageViews: [], dailyViews: [], chatDays: [], currentPages: [], manualEdits: [], runs: [] },
    new Date(),
    windowDays,
  );
}

export async function getTomeUsageAnalytics(windowDays = 30): Promise<TomeUsageAnalytics> {
  try {
    const [projects, events, messages, revisions, runs, users] = await Promise.all([
      getCollection<ProjectDocument>("projects"),
      getTomeUsageEventsCollection(),
      getTomeChatMessagesCollection(),
      getCollection<PageRevision>("tome_page_revisions"),
      getCollection<IngestRun>("tome_ingest_runs"),
      getCollection<User>("users"),
    ]);
    const now = new Date();
    const cutoff = new Date(now.getTime() - windowDays * DAY_MS);
    const projectRows = await projects.find(ANALYTICS_PROJECT_MATCH).project({ slug: 1 }).toArray();
    const projectIds = projectRows.map((project) => String(project._id));
    if (projectIds.length === 0) return emptyUsage(windowDays);

    const [subjectRows, pageViewRows, dailyViewRows, chatDayRows, currentPageRows, manualEditRows, runRows, trackingStartRow, revisionSourceRows] = await Promise.all([
      events.aggregate<{
        _id: string;
        lastAt: Date;
        days: string[];
        sessions: string[];
        views: number;
        chatViewed: number;
      }>([
        { $match: { event: "view", occurred_at: { $gte: cutoff }, project_id: { $in: projectIds } } },
        {
          $group: {
            _id: "$subject_hash",
            lastAt: { $max: "$occurred_at" },
            days: { $addToSet: { $dateToString: { format: "%Y-%m-%d", date: "$occurred_at" } } },
            sessions: { $addToSet: "$analytics_session_id" },
            views: { $sum: 1 },
            chatViewed: { $max: { $cond: [{ $eq: ["$view_kind", "agent"] }, 1, 0] } },
          },
        },
      ]).toArray(),
      events.aggregate<{
        _id: { projectId: string; projectSlug: string; pagePath: string };
        views: number;
        viewerIds: string[];
        lastViewedAt: Date;
      }>([
        { $match: { event: "view", view_kind: "page", occurred_at: { $gte: cutoff }, project_id: { $in: projectIds }, page_path: { $ne: null } } },
        {
          $group: {
            _id: { projectId: "$project_id", projectSlug: "$project_slug", pagePath: "$page_path" },
            views: { $sum: 1 },
            viewerIds: { $addToSet: "$subject_hash" },
            lastViewedAt: { $max: "$occurred_at" },
          },
        },
      ]).toArray(),
      events.aggregate<{ _id: string; subjectHashes: string[]; pageViews: number; chatViewers: number }>([
        { $match: { event: "view", occurred_at: { $gte: cutoff }, project_id: { $in: projectIds } } },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$occurred_at" } },
              subject: "$subject_hash",
            },
            pageViews: { $sum: { $cond: [{ $eq: ["$view_kind", "page"] }, 1, 0] } },
            chatViewed: { $max: { $cond: [{ $eq: ["$view_kind", "agent"] }, 1, 0] } },
          },
        },
        {
          $group: {
            _id: "$_id.date",
            subjectHashes: { $addToSet: "$_id.subject" },
            pageViews: { $sum: "$pageViews" },
            chatViewers: { $sum: "$chatViewed" },
          },
        },
      ]).toArray(),
      messages.aggregate<{
        _id: { date: string; userId: string };
        prompts: number;
      }>([
        { $match: { role: "user", created_at: { $gte: cutoff }, project_id: { $in: projectIds } } },
        { $lookup: { from: "tome_chat_sessions", localField: "session_id", foreignField: "_id", as: "session" } },
        { $unwind: "$session" },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
              userId: "$session.user_id",
            },
            prompts: { $sum: 1 },
          },
        },
      ]).toArray(),
      revisions.aggregate<{
        _id: { projectId: string; path: string };
        markdown?: string;
        templateScope?: string | null;
        hasTemplateScope: boolean;
        deleted?: boolean;
      }>([
        { $match: { project_id: { $in: projectIds }, status: { $nin: ["draft", "rejected"] } } },
        { $sort: { project_id: 1, path: 1, created_at: -1, _id: -1 } },
        {
          $group: {
            _id: { projectId: "$project_id", path: "$path" },
            markdown: { $first: "$markdown" },
            templateScope: { $first: "$template_scope" },
            hasTemplateScope: { $first: { $ne: [{ $type: "$template_scope" }, "missing"] } },
            deleted: { $first: "$deleted" },
          },
        },
        { $match: { deleted: { $ne: true } } },
      ]).toArray(),
      revisions.aggregate<{
        _id: { editor: string; projectId: string; path: string };
        revisions: number;
      }>([
        {
          $match: {
            project_id: { $in: projectIds },
            created_at: { $gte: cutoff },
            deleted: { $ne: true },
            $or: [
              { origin: "manual" },
              {
                origin: { $exists: false },
                report_id: { $exists: false },
                author: { $regex: "@", $not: / via tome-agent-/ },
                message: { $not: /^import / },
              },
            ],
          },
        },
        { $group: { _id: { editor: "$author", projectId: "$project_id", path: "$path" }, revisions: { $sum: 1 } } },
      ]).toArray(),
      runs.find(
        {
          project_id: { $in: projectIds },
          $or: [
            { started_at: { $gte: cutoff } },
            { finished_at: { $gte: cutoff } },
            { reviewed_at: { $gte: cutoff } },
            { status: "awaiting_review" },
          ],
        },
        { projection: { status: 1, started_at: 1, finished_at: 1, reviewed_at: 1, review_outcome: 1, "dispatch.endpoint": 1 } },
      ).toArray(),
      events.find(
        { event: "view", project_id: { $in: projectIds } },
        { projection: { occurred_at: 1 } },
      ).sort({ occurred_at: 1 }).limit(1).next(),
      revisions.aggregate<{ _id: string; revisions: number }>([
        { $match: { project_id: { $in: projectIds }, created_at: { $gte: cutoff, $lte: now }, deleted: { $ne: true } } },
        { $group: { _id: { $ifNull: ["$origin", "legacy"] }, revisions: { $sum: 1 } } },
      ], { maxTimeMS: 15_000 }).toArray(),
    ]);
    const chatUserIds = [...new Set(chatDayRows.map((row) => row._id.userId).filter(Boolean))];
    const chatUsers = chatUserIds.length > 0
      ? await users.find(
          { email: { $in: chatUserIds } },
          { projection: { email: 1, keycloak_sub: 1, "metadata.keycloak_sub": 1 } },
        ).toArray()
      : [];
    const chatSubjectsByEmail = new Map(
      chatUsers.map((user) => [
        user.email.toLowerCase(),
        user.keycloak_sub?.trim() || user.metadata?.keycloak_sub?.trim() || user.email,
      ]),
    );
    return summarizeTomeUsageAnalytics(
      {
        trackingStartedAt: trackingStartRow?.occurred_at ?? null,
        revisionSources: revisionSourceRows.map((row) => ({ origin: row._id, revisions: row.revisions })),
        subjects: subjectRows.map((row) => ({
          subjectHash: row._id,
          lastAt: row.lastAt,
          days: row.days,
          sessions: row.sessions,
          views: row.views,
          chatViewed: row.chatViewed === 1,
        })),
        pageViews: pageViewRows.map((row) => ({
          projectId: row._id.projectId,
          projectSlug: row._id.projectSlug,
          pagePath: row._id.pagePath,
          views: row.views,
          viewerIds: row.viewerIds,
          lastViewedAt: row.lastViewedAt,
        })),
        dailyViews: dailyViewRows.map((row) => ({
          date: row._id,
          subjectHashes: row.subjectHashes,
          pageViews: row.pageViews,
          chatViewers: row.chatViewers,
        })),
        chatDays: chatDayRows.map((row) => ({
          date: row._id.date,
          subjectHash: hashTomeSubject(
            chatSubjectsByEmail.get(row._id.userId.toLowerCase()) ?? row._id.userId,
          ),
          prompts: row.prompts,
        })),
        currentPages: currentPageRows.map((row) => ({
          projectId: row._id.projectId,
          path: row._id.path,
          markdown: row.markdown,
          templateScope: row.hasTemplateScope ? row.templateScope : undefined,
        })),
        manualEdits: manualEditRows.map((row) => ({
          editor: row._id.editor,
          projectId: row._id.projectId,
          path: row._id.path,
          revisions: row.revisions,
        })),
        runs: runRows.map((run) => ({
          status: run.status,
          startedAt: run.started_at,
          finishedAt: run.finished_at,
          reviewedAt: run.reviewed_at,
          reviewOutcome: run.review_outcome,
          endpoint: run.dispatch?.endpoint,
        })),
      },
      now,
      windowDays,
    );
  } catch (error) {
    console.warn("[tome-analytics] failed to load product usage", error);
    throw error;
  }
}
