"use client";

import { CalendarDays, CheckCircle2, Clock, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PanelShell } from "@/components/tome/PanelHeader";
import { TomeEmpty } from "@/components/tome/TomeEmpty";
import type { WebexMeetingSeriesSubscription } from "@/types/projects";
import type {
  WebexMeetingOccurrenceStatus,
  WebexMeetingOccurrenceSummary,
} from "@/types/tome";
import { cn } from "@/lib/utils";

/**
 * The meetings this space listens to, and what came of each one.
 *
 * The same series the settings panel configures, read rather than edited: a
 * reader asking "was Tuesday's call written up?" wants an answer, not a form.
 * Setting them up stays in settings, which is where the rest of what a space
 * ingests is arranged.
 */

/** How each occurrence state reads, and how plainly it should be drawn. */
const STATUS: Record<
  WebexMeetingOccurrenceStatus,
  { label: string; tone: "done" | "waiting" | "failed" }
> = {
  pending: { label: "Scheduled", tone: "waiting" },
  processing: { label: "Processing", tone: "waiting" },
  waiting_transcript: { label: "Waiting for the transcript", tone: "waiting" },
  ready: { label: "Ready to write up", tone: "waiting" },
  queued: { label: "Queued", tone: "waiting" },
  ingested: { label: "Written up", tone: "done" },
  skipped: { label: "Skipped", tone: "waiting" },
  failed: { label: "Failed", tone: "failed" },
};

function StatusMark({ status }: { status: WebexMeetingOccurrenceStatus }) {
  const { label, tone } = STATUS[status] ?? { label: status, tone: "waiting" };
  const Icon = tone === "done" ? CheckCircle2 : tone === "failed" ? TriangleAlert : Clock;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs",
        tone === "done" && "text-emerald-600 dark:text-emerald-400",
        tone === "failed" && "text-destructive",
        tone === "waiting" && "text-muted-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

/** A date a person would say out loud, not a timestamp. */
function occurrenceDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function MeetingsView({ slug }: { slug: string }) {
  const [subscriptions, setSubscriptions] = useState<WebexMeetingSeriesSubscription[]>([]);
  const [occurrences, setOccurrences] = useState<WebexMeetingOccurrenceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/tome/projects/${encodeURIComponent(slug)}/webex-meeting-series`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("Could not load this space's meetings.");
      setSubscriptions(body?.data?.subscriptions ?? []);
      setOccurrences(body?.data?.occurrences ?? []);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load this space's meetings.",
      );
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PanelShell
      title="Meetings"
      description="The recurring calls this space listens to, and what came of each one. Transcripts become pages once a meeting ends."
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading meetings…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : subscriptions.length === 0 ? (
        <TomeEmpty
          icon={<CalendarDays />}
          headline="No meetings yet"
          hint="Subscribe this space to a recurring Webex meeting and its transcripts will be written up here after each call."
          action={{
            label: "Set up meetings",
            href: `/projects/${encodeURIComponent(slug)}/tome/settings`,
          }}
        />
      ) : (
        <div className="space-y-6">
          {subscriptions.map((series) => {
            // Most recent first: the question asked here is almost always
            // about the call that just happened.
            const held = occurrences
              .filter((occurrence) => occurrence.subscriptionId === series.id)
              .sort((a, b) => b.start.localeCompare(a.start));

            return (
              <section key={series.id} className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="truncate text-sm font-medium text-foreground">
                    {series.title}
                  </h3>
                  {series.nextOccurrenceStartAt && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Next {occurrenceDate(series.nextOccurrenceStartAt)}
                    </span>
                  )}
                </div>

                {held.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                    Nothing held yet. The first write-up appears after this
                    series next meets.
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {held.map((occurrence) => (
                      <li
                        key={occurrence.id}
                        className="flex items-center justify-between gap-3 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-foreground">
                            {occurrence.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {occurrenceDate(occurrence.start)}
                          </p>
                        </div>
                        <StatusMark status={occurrence.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </PanelShell>
  );
}
