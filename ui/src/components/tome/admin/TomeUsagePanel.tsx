"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { TomeAnalyticsSnapshot } from "@/lib/tome/analytics-types";
import type { ActivityPeriod } from "@/lib/tome/chat-analytics";
import {
  AnalyticsSection,
  count,
  dateLabel,
  Metric,
  type SortDirection,
  SortableTableHeader,
  TomeActivityChart,
} from "./AnalyticsPrimitives";

type UsageSortKey = "users" | "prompts";

export function TomeUsagePanel({
  chat,
  usage,
}: Pick<TomeAnalyticsSnapshot, "chat" | "usage">) {
  const [period, setPeriod] = useState<ActivityPeriod>("month");
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const [usageSort, setUsageSort] = useState<{
    key: UsageSortKey;
    direction: SortDirection;
  }>({ key: "users", direction: "desc" });
  const entities = useMemo(() => {
    const direction = usageSort.direction === "asc" ? 1 : -1;
    return (chat?.entities ?? [])
      .filter(
        (entity) =>
          (type === "all" || entity.type === type) &&
          entity.name.toLowerCase().includes(query.toLowerCase()),
      )
      .sort(
        (a, b) =>
          direction *
            (a.activity[period][usageSort.key] -
              b.activity[period][usageSort.key]) ||
          a.name.localeCompare(b.name),
      );
  }, [chat, type, query, period, usageSort]);
  const sortUsageBy = (key: UsageSortKey) => {
    setUsageSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  };
  if (!chat)
    return (
      <p role="status" className="py-8 text-muted-foreground">
        Chat usage is unavailable. Refresh to try again.
      </p>
    );
  const selected = chat.periods[period];
  const latestUsage = usage?.daily[usage.daily.length - 1];
  const latestChatDay = chat.daily[chat.daily.length - 1];
  const chatUsersToday = latestUsage?.chatUsers ?? latestChatDay?.users ?? 0;
  const activityDaily =
    usage?.daily ??
    chat.daily.map((row) => ({
      date: row.date,
      activeUsers: null,
      tomeUsers: null,
      chatUsers: row.users,
    }));
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label="Tome users today"
          value={
            latestUsage?.activeUsers === null ||
            latestUsage?.activeUsers === undefined
              ? "—"
              : count(latestUsage.activeUsers)
          }
          detail="People who opened Tome or chatted with it today"
        />
        <Metric
          label="Tome visitors today"
          value={
            latestUsage?.tomeUsers === null ||
            latestUsage?.tomeUsers === undefined
              ? "—"
              : count(latestUsage.tomeUsers)
          }
          detail="People who opened Tome today"
        />
        <Metric
          label="Tome chat users today"
          value={count(chatUsersToday)}
          detail="People who chatted with Tome today"
        />
      </div>
      <AnalyticsSection
        title="Where people use Tome"
        description="See which projects, Areas, and BHAGs people are chatting with Tome about."
      >
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="tome-activity-period" className="text-sm">
            Time period
          </label>
          <Select
            id="tome-activity-period"
            className="w-40"
            value={period}
            onChange={(event) =>
              setPeriod(event.target.value as ActivityPeriod)
            }
          >
            <option value="day">Last 24 hours</option>
            <option value="week">Last 7 days</option>
            <option value="month">Last 30 days</option>
          </Select>
          <span className="text-sm text-muted-foreground">
            {count(selected.users)} people · {count(selected.prompts)} messages
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["project", "Projects used"],
              ["area", "Areas used"],
              ["bhag", "BHAGs used"],
            ] as const
          ).map(([key, label]) => (
            <Metric
              key={key}
              label={label}
              value={`${selected.activeEntities[key]} of ${chat.totals[key]}`}
              detail="Used during this period"
            />
          ))}
        </div>
      </AnalyticsSection>
      <AnalyticsSection
        title="Tome use over time"
        description={`See how many people opened Tome or chatted with it each day. Today's numbers may still change. ${usage?.tracking.startedAt ? `Visitor data is available from ${dateLabel(usage.tracking.startedAt)}.` : "Visitor data will appear after someone opens Tome."}`}
      >
        <TomeActivityChart daily={activityDaily} />
      </AnalyticsSection>
      <AnalyticsSection
        title="Chat activity"
        description="See how people chat with Tome across projects, Areas, and BHAGs."
      >
        <div className="flex flex-wrap gap-3">
          <Input
            aria-label="Search projects, Areas, and BHAGs"
            placeholder="Search projects, Areas, and BHAGs…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-xs"
          />
          <Select
            aria-label="Type"
            className="w-40"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="all">All types</option>
            <option value="project">Projects</option>
            <option value="area">Areas</option>
            <option value="bhag">BHAGs</option>
          </Select>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table
            className="w-full text-sm"
            aria-label="Chat activity by project, Area, and BHAG"
          >
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-3">Name</th>
                <th className="p-3">Type</th>
                <SortableTableHeader
                  label="People"
                  active={usageSort.key === "users"}
                  direction={usageSort.direction}
                  onSort={() => sortUsageBy("users")}
                />
                <SortableTableHeader
                  label="Messages"
                  active={usageSort.key === "prompts"}
                  direction={usageSort.direction}
                  onSort={() => sortUsageBy("prompts")}
                />
                <th className="p-3">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {entities.map((entity) => (
                <tr key={entity.id} className="border-t">
                  <td className="p-3">
                    <Link
                      className="font-medium hover:underline"
                      href={`/projects/${encodeURIComponent(entity.slug)}/tome`}
                    >
                      {entity.name}
                    </Link>
                  </td>
                  <td className="p-3">
                    {entity.type === "bhag"
                      ? "BHAG"
                      : entity.type === "area"
                        ? "Area"
                        : "Project"}
                  </td>
                  <td className="p-3 tabular-nums">
                    {entity.activity[period].users}
                  </td>
                  <td className="p-3 tabular-nums">
                    {count(entity.activity[period].prompts)}
                  </td>
                  <td className="p-3">
                    {entity.lastPromptAt
                      ? dateLabel(entity.lastPromptAt)
                      : "No chat activity in the last 30 days"}
                  </td>
                </tr>
              ))}
              {entities.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="p-6 text-center text-muted-foreground"
                  >
                    No matches found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AnalyticsSection>
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">
          Reading activity
        </summary>
        {!usage ? (
          <p className="mt-3 text-muted-foreground">
            Reading activity is temporarily unavailable. Refresh to try again.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              {usage.tracking.startedAt
                ? `Visitor data is available from ${dateLabel(usage.tracking.startedAt)}. ${usage.tracking.coverageDays} days of activity are shown.`
                : "Visitor data will appear after someone opens Tome."}{" "}
              Opening Tome shows interest; chatting with Tome shows active use.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric
                label="Tome visitors"
                value={
                  usage.tracking.startedAt ? usage.reach.monthlyUsers : "—"
                }
                detail={`${usage.reach.dailyUsers} today · ${usage.reach.weeklyUsers} in the last 7 days`}
              />
              <Metric
                label="Opened Tome chat"
                value={usage.tracking.startedAt ? usage.chat.viewers : "—"}
                detail="People who opened chat"
              />
              <Metric
                label="Wiki page views"
                value={
                  usage.tracking.startedAt ? count(usage.pages.views) : "—"
                }
                detail={`${usage.pages.uniqueViewers} readers`}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {usage.reach.returningUsers} returning visitors ·{" "}
              {usage.reach.sessions} visits · {usage.reach.views} total views
            </p>
            <h4 className="text-sm font-medium">Most read pages</h4>
            <ul className="divide-y text-sm">
              {usage.pages.top.map((page) => (
                <li
                  key={`${page.projectId}:${page.pagePath}`}
                  className="flex flex-wrap justify-between gap-2 py-2"
                >
                  <span>
                    {page.projectSlug} / {page.pagePath}
                  </span>
                  <span className="text-muted-foreground">
                    {page.views} views · {page.uniqueViewers} readers
                  </span>
                </li>
              ))}
            </ul>
            {usage.pages.top.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No page views recorded.
              </p>
            )}
          </div>
        )}
      </details>
    </div>
  );
}
