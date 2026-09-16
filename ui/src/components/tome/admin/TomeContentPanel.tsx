"use client";

import Link from "next/link";
import type { TomeAnalyticsSnapshot } from "@/lib/tome/analytics-types";
import {
  AnalyticsSection,
  count,
  dateLabel,
  Metric,
} from "./AnalyticsPrimitives";

const originLabels: Record<string, string> = {
  manual: "Manual edits",
  import: "Imports",
  ingest: "Source ingestion",
  chat_agent: "Chat agents",
  template: "Template seeding",
  system: "System",
  legacy: "Legacy · unattributed",
};

export function TomeContentPanel({ data }: { data: TomeAnalyticsSnapshot }) {
  const { usage, leadership, freshness, projects, performance, uptime } = data;
  return (
    <div className="space-y-6">
      <AnalyticsSection
        title="Knowledge and review"
        description="Freshness uses source activity or successful ingestion. Human rejection is separate from technical failure."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Fresh projects"
            value={
              leadership
                ? `${leadership.sourceHealth.fresh} / ${leadership.onboarding.totalProjects}`
                : "—"
            }
            detail={
              leadership
                ? `${leadership.sourceHealth.stale} stale · ${leadership.sourceHealth.never} never refreshed`
                : undefined
            }
          />
          <Metric
            label="Ingestion failures"
            value={usage ? usage.ingestion.failed : "—"}
            detail="Technical failures · runs started in 30d"
          />
          <Metric
            label="Pending reviews"
            value={usage ? usage.drafts.pending : "—"}
            detail="Current backlog, including older runs"
          />
          <Metric
            label="Human rejections"
            value={usage ? usage.drafts.rejected : "—"}
            detail="Review outcomes in 30d"
          />
        </div>
        {usage && (
          <p className="text-sm text-muted-foreground">
            {usage.ingestion.succeeded} ingests published ·{" "}
            {usage.drafts.approved} human approvals ·{" "}
            {usage.drafts.autoPromoted} auto-promotions in their respective
            30-day windows.
          </p>
        )}
      </AnalyticsSection>
      <AnalyticsSection
        title="Ingestion by entity"
        description="Open an entity's ingestion history to investigate failures or pending reviews. Fresh: ≤7d; aging: ≤30d; stale: >30d."
      >
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-3">Entity</th>
                <th className="p-3">Pages</th>
                <th className="p-3">Last successful ingest</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.projectId} className="border-t">
                  <td className="p-3 font-medium">{project.title}</td>
                  <td className="p-3">{count(project.pageCount)}</td>
                  <td className="p-3">
                    {project.lastIngestedAt
                      ? dateLabel(project.lastIngestedAt)
                      : "Never"}
                    {project.activeIngest && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        In progress
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <Link
                      className="text-primary hover:underline"
                      href={`/projects/${encodeURIComponent(project.slug)}/tome/ingest`}
                    >
                      View runs
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
                    No ingestion history available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AnalyticsSection>
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">
          Templates and revision sources
        </summary>
        {!usage ? (
          <p className="mt-3 text-muted-foreground">
            Content usage is unavailable.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-sm">
              {count(usage.templates.boundPages)} bound pages in{" "}
              {usage.templates.projectsUsingTemplates} entities ·{" "}
              {count(usage.templates.unboundPages)} unbound pages ·{" "}
              {count(usage.templates.views)} template page views.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left">
                  <tr>
                    <th className="p-2">Template scope</th>
                    <th className="p-2">Pages</th>
                    <th className="p-2">Entities</th>
                    <th className="p-2">Views</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.templates.byScope.map((scope) => (
                    <tr key={scope.scope} className="border-t">
                      <td className="p-2">{scope.scope}</td>
                      <td className="p-2">{scope.pages}</td>
                      <td className="p-2">{scope.projects}</td>
                      <td className="p-2">{scope.views}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h4 className="text-sm font-medium">Revision sources · 30 days</h4>
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
              Historical manual edits are recovered where author and revision
              metadata identify them. Other revisions without attribution remain
              labeled legacy.
            </p>
          </div>
        )}
      </details>
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">
          Feedback and service health
        </summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric
            label="Rated-answer satisfaction"
            value={
              freshness?.satisfactionRate == null
                ? "No ratings"
                : `${(freshness.satisfactionRate * 100).toFixed(0)}%`
            }
            detail={
              freshness
                ? `${freshness.positive} positive · ${freshness.negative} negative. Ratings are a self-selected sample.`
                : "Unavailable"
            }
          />
          <Metric
            label="Chat latency (p95)"
            value={
              performance?.p95Seconds == null
                ? "Not measured"
                : `${performance.p95Seconds.toFixed(1)}s`
            }
            detail="Last hour"
          />
          <Metric
            label="Availability"
            value={
              uptime?.uptimePct == null
                ? "Not measured"
                : `${uptime.uptimePct.toFixed(1)}%`
            }
            detail={
              uptime?.status === "collecting"
                ? "Baseline collecting"
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
