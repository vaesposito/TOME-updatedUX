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
  TomeActivityChart,
} from "./AnalyticsPrimitives";

const periodLabels = { day: "24 hours", week: "7 days", month: "30 days" };

export function TomeUsagePanel({
  chat,
  usage,
}: Pick<TomeAnalyticsSnapshot, "chat" | "usage">) {
  const [period, setPeriod] = useState<ActivityPeriod>("month");
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const entities = useMemo(
    () =>
      (chat?.entities ?? [])
        .filter(
          (entity) =>
            (type === "all" || entity.type === type) &&
            entity.name.toLowerCase().includes(query.toLowerCase()),
        )
        .sort(
          (a, b) =>
            b.activity[period].users - a.activity[period].users ||
            b.activity[period].prompts - a.activity[period].prompts ||
            a.name.localeCompare(b.name),
        ),
    [chat, type, query, period],
  );
  if (!chat)
    return (
      <p role="status" className="py-8 text-muted-foreground">
        Chat usage is unavailable. Refresh to try again.
      </p>
    );
  const selected = chat.periods[period];
  const latestUsage = usage?.daily[usage.daily.length - 1];
  const activityDaily = usage?.daily ?? chat.daily.map((row) => ({
    date: row.date,
    activeUsers: null,
    tomeUsers: null,
    chatUsers: row.users,
  }));
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Tome DAU"
          value={latestUsage?.activeUsers === null || latestUsage?.activeUsers === undefined
            ? "—"
            : count(latestUsage.activeUsers)}
          detail="Opened Tome or sent a prompt · UTC today"
        />
        <Metric
          label="Tome visitors today"
          value={latestUsage?.tomeUsers === null || latestUsage?.tomeUsers === undefined
            ? "—"
            : count(latestUsage.tomeUsers)}
          detail="Distinct authenticated people · UTC today"
        />
        <Metric
          label="Chat DAU"
          value={count(chat.periods.day.users)}
          detail="Unique prompt senders · trailing 24 hours"
        />
        <Metric
          label="Chat MAU"
          value={count(chat.periods.month.users)}
          detail={`${count(chat.periods.week.users)} weekly active users · trailing 30 days`}
        />
      </div>
      <AnalyticsSection
        title="Active entities"
        description="An entity is active when someone sends a prompt on it. Child activity and scheduled ingestion are excluded."
      >
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="tome-activity-period" className="text-sm">
            Activity window
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
            {count(selected.users)} people · {count(selected.prompts)} prompts
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["project", "Active projects"],
              ["area", "Active Areas"],
              ["bhag", "Active BHAGs"],
            ] as const
          ).map(([key, label]) => (
            <Metric
              key={key}
              label={label}
              value={`${selected.activeEntities[key]} / ${chat.totals[key]}`}
              detail={`Non-archived entities · ${periodLabels[period]}`}
            />
          ))}
        </div>
      </AnalyticsSection>
      <AnalyticsSection
        title="Daily Tome users"
        description="Tome active users is the deduplicated union of people who opened Tome and people who sent a Tome Agent prompt. Visitors and chat users remain visible separately. Today is partial."
      >
        <TomeActivityChart daily={activityDaily} />
      </AnalyticsSection>
      <AnalyticsSection
        title="Usage by entity"
        description="People can use multiple entities, so row user counts do not add up to organization-wide unique users."
      >
        <div className="flex flex-wrap gap-3">
          <Input
            aria-label="Search entities"
            placeholder="Search entities…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-xs"
          />
          <Select
            aria-label="Entity type"
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
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-3">Entity</th>
                <th className="p-3">Type</th>
                <th className="p-3">Chat users</th>
                <th className="p-3">Prompts</th>
                <th className="p-3">Last prompt</th>
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
                      : "No prompts in 30d"}
                  </td>
                </tr>
              ))}
              {entities.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="p-6 text-center text-muted-foreground"
                  >
                    No matching entities.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AnalyticsSection>
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">
          Reading and discovery
        </summary>
        {!usage ? (
          <p className="mt-3 text-muted-foreground">
            Reading telemetry is unavailable.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              {usage.tracking.startedAt
                ? `View tracking began ${dateLabel(usage.tracking.startedAt)}. ${usage.tracking.coverageDays} of 30 days covered.`
                : "View tracking has not started. Counts are unavailable until the first recorded view."}{" "}
              Reading and Agent opens are discovery signals; sending a prompt
              defines chat activity.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric
                label="Tome viewers"
                value={
                  usage.tracking.startedAt ? usage.reach.monthlyUsers : "—"
                }
                detail={`${usage.reach.dailyUsers} daily · ${usage.reach.weeklyUsers} weekly`}
              />
              <Metric
                label="Opened Agent"
                value={usage.tracking.startedAt ? usage.chat.viewers : "—"}
                detail="Distinct viewers · tracked portion of 30 days"
              />
              <Metric
                label="Wiki page views"
                value={
                  usage.tracking.startedAt ? count(usage.pages.views) : "—"
                }
                detail={`${usage.pages.uniqueViewers} unique page readers`}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {usage.reach.returningUsers} viewers returned on 2+ UTC days ·{" "}
              {usage.reach.sessions} browser sessions · {usage.reach.views}{" "}
              views. Browser sessions last until the tab is closed.
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
