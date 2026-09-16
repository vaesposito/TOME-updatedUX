"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TomeAnalyticsSnapshot } from "@/lib/tome/analytics-types";
import {
  AnalyticsSection,
  count,
  dateLabel,
  Metric,
  type SortDirection,
  SortableTableHeader,
} from "./AnalyticsPrimitives";

const originLabels: Record<string, string> = {
  manual: "Edited by people",
  import: "Imported files",
  ingest: "Source updates",
  chat_agent: "Tome chat",
  template: "Template setup",
  system: "Tome",
  legacy: "Older activity",
};

const templateLabels: Record<string, string> = {
  "top-level": "Project overview",
  github: "GitHub",
  confluence: "Confluence",
  webex: "Webex",
};

export function TomeContentPanel({ data }: { data: TomeAnalyticsSnapshot }) {
  const { usage, leadership, freshness, projects, performance, uptime } = data;
  const [pageSort, setPageSort] = useState<SortDirection | null>(null);
  const sortedProjects = useMemo(() => {
    if (!pageSort) return projects;
    const direction = pageSort === "asc" ? 1 : -1;
    return [...projects].sort(
      (a, b) =>
        direction * (a.pageCount - b.pageCount) ||
        a.title.localeCompare(b.title),
    );
  }, [pageSort, projects]);
  return (
    <div className="space-y-6">
      <AnalyticsSection
        title="Content health"
        description="See what is up to date and where an update or review needs attention."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Up-to-date projects"
            value={
              leadership
                ? `${leadership.sourceHealth.fresh} / ${leadership.onboarding.totalProjects}`
                : "—"
            }
            detail={
              leadership
                ? `${leadership.sourceHealth.stale} need an update · ${leadership.sourceHealth.never} have never been updated`
                : undefined
            }
          />
          <Metric
            label="Update failures"
            value={usage ? usage.ingestion.failed : "—"}
            detail="Updates that failed in the last 30 days"
          />
          <Metric
            label="Waiting for review"
            value={usage ? usage.drafts.pending : "—"}
            detail="Draft updates that still need a decision"
          />
          <Metric
            label="Rejected updates"
            value={usage ? usage.drafts.rejected : "—"}
            detail="Draft updates rejected in the last 30 days"
          />
        </div>
        {usage && (
          <p className="text-sm text-muted-foreground">
            {usage.ingestion.succeeded} source updates completed ·{" "}
            {usage.drafts.approved} approved after review ·{" "}
            {usage.drafts.autoPromoted} published automatically in the last 30
            days.
          </p>
        )}
      </AnalyticsSection>
      <AnalyticsSection
        title="Content by project, Area, and BHAG"
        description="See how much content each space has, when it was last updated, and where an update needs attention."
      >
        <div className="overflow-x-auto rounded-lg border">
          <table
            className="w-full text-sm"
            aria-label="Content by project, Area, and BHAG"
          >
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-3">Name</th>
                <SortableTableHeader
                  label="Pages"
                  active={pageSort !== null}
                  direction={pageSort ?? "desc"}
                  onSort={() =>
                    setPageSort((current) =>
                      current === "desc" ? "asc" : "desc",
                    )
                  }
                />
                <th className="p-3">Last updated</th>
                <th className="p-3">History</th>
              </tr>
            </thead>
            <tbody>
              {sortedProjects.map((project) => (
                <tr key={project.projectId} className="border-t">
                  <td className="p-3 font-medium">{project.title}</td>
                  <td className="p-3">{count(project.pageCount)}</td>
                  <td className="p-3">
                    {project.lastIngestedAt
                      ? dateLabel(project.lastIngestedAt)
                      : "Never"}
                    {project.activeIngest && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        Updating now
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <Link
                      className="text-primary hover:underline"
                      href={`/projects/${encodeURIComponent(project.slug)}/tome/ingest`}
                    >
                      View update history
                    </Link>
                  </td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="p-6 text-center text-muted-foreground"
                  >
                    No content update history yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AnalyticsSection>
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">
          Templates and page changes
        </summary>
        {!usage ? (
          <p className="mt-3 text-muted-foreground">
            Content usage is unavailable.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-sm">
              {count(usage.templates.boundPages)} pages use templates across{" "}
              {usage.templates.projectsUsingTemplates} projects, Areas, or
              BHAGs. {count(usage.templates.unboundPages)} pages do not use a
              template. Template-based pages were viewed{" "}
              {count(usage.templates.views)} times.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left">
                  <tr>
                    <th className="p-2">Template</th>
                    <th className="p-2">Pages using it</th>
                    <th className="p-2">Projects, Areas, and BHAGs</th>
                    <th className="p-2">Page views</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.templates.byScope.map((scope) => (
                    <tr key={scope.scope} className="border-t">
                      <td className="p-2">
                        {templateLabels[scope.scope] ?? scope.scope}
                      </td>
                      <td className="p-2">{scope.pages}</td>
                      <td className="p-2">{scope.projects}</td>
                      <td className="p-2">{scope.views}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h4 className="text-sm font-medium">
              How pages changed in the last 30 days
            </h4>
            <div className="flex flex-wrap gap-3">
              {usage.revisionSources.map((row) => (
                <span
                  className="rounded-md bg-muted px-3 py-2 text-sm"
                  key={row.origin}
                >
                  {originLabels[row.origin] ?? row.origin}:{" "}
                  {count(row.revisions)}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Some older changes do not contain enough history to show how they
              were made.
            </p>
          </div>
        )}
      </details>
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">
          Experience and reliability
        </summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric
            label="Helpful answers"
            value={
              freshness?.satisfactionRate == null
                ? "No ratings"
                : `${(freshness.satisfactionRate * 100).toFixed(0)}%`
            }
            detail={
              freshness
                ? `${freshness.positive} helpful · ${freshness.negative} not helpful. Based on submitted ratings.`
                : "Ratings are unavailable"
            }
          />
          <Metric
            label="Chat completion time"
            value={
              performance?.p95Seconds == null
                ? "Waiting for data"
                : `${performance.p95Seconds.toFixed(1)}s`
            }
            detail="95% of chats finished within this time in the last hour"
          />
          <Metric
            label="Availability"
            value={
              uptime?.uptimePct == null
                ? "Waiting for data"
                : `${uptime.uptimePct.toFixed(1)}%`
            }
            detail={
              uptime?.status === "collecting"
                ? "Collecting data"
                : "Last 24 hours"
            }
          />
        </div>
        <Link
          href="/admin?cat=insights&tab=feedback&dateRange=30d"
          className="mt-3 inline-block text-sm text-primary hover:underline"
        >
          Review feedback
        </Link>
      </details>
    </div>
  );
}
