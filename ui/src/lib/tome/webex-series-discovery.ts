import { ApiError } from "@/lib/api-error";
import type { Invoke } from "./webex-meeting-series";

const DAY_MS = 24 * 60 * 60_000;
type Source = "meetingSeries" | "scheduledMeetings" | "meetingInstances" | "userHubCalendar";
type Row = Record<string, unknown>;
interface Page { items: Row[]; siteUrl?: string }
export interface SeriesDiscoveryInput { from: Date; to: Date; siteUrl?: string; now?: Date }
interface Job { source: Source; tool: string; params: Record<string, unknown>; from?: Date; to?: Date; limit: number }

export function webexSeriesDiscoveryTimeoutMs(value = process.env.TOME_WEBEX_SERIES_DISCOVERY_TIMEOUT_MS): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(120_000, Math.max(1000, parsed)) : 45_000;
}

/** At most seven UTC calendar dates per request; no gaps between windows. */
export function webexOccurrenceWindows(from: Date, to: Date): Array<{ from: Date; to: Date }> {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new ApiError("Invalid meeting discovery window.", 400, "INVALID_DISCOVERY_WINDOW");
  }
  const windows: Array<{ from: Date; to: Date }> = [];
  for (let start = from.getTime(); start < to.getTime();) {
    const midnight = Math.floor(start / DAY_MS) * DAY_MS;
    const end = Math.min(midnight + 7 * DAY_MS, to.getTime());
    windows.push({ from: new Date(start), to: new Date(end) });
    start = end;
  }
  return windows;
}

/** Read-only discovery: one template request, bounded occurrence requests, no retries. */
export async function queryWebexMeetingSeries(invoke: Invoke, input: SeriesDiscoveryInput) {
  const pages: Record<Source, Page> = {
    meetingSeries: { items: [] }, scheduledMeetings: { items: [] },
    meetingInstances: { items: [] }, userHubCalendar: { items: [] },
  };
  const jobs: Job[] = [{ source: "meetingSeries", tool: "webex_list_meetings", params: { meeting_type: "meetingSeries", max_results: 100 }, limit: 100 }];
  const now = input.now ?? new Date();
  const pastEnd = new Date(Math.min(now.getTime(), input.to.getTime()));
  if (input.from < pastEnd) {
    for (const window of webexOccurrenceWindows(input.from, pastEnd)) {
      jobs.push({ source: "meetingInstances", tool: "webex_list_meetings", params: { meeting_type: "meeting", max_results: 100 }, ...window, limit: 100 });
    }
  }
  for (const window of webexOccurrenceWindows(input.from, input.to)) {
    jobs.push(
      { source: "scheduledMeetings", tool: "webex_list_meetings", params: { meeting_type: "scheduledMeeting", max_results: 100 }, ...window, limit: 100 },
      { source: "userHubCalendar", tool: "webex_userhub_calendar", params: { meeting_list_type: "All", max_results: 500, ...(input.siteUrl ? { site_url: input.siteUrl } : {}) }, ...window, limit: 500 },
    );
  }
  const warnings = new Set<string>();
  const labels: Record<Source, string> = {
    meetingSeries: "Meeting series", scheduledMeetings: "Scheduled meetings",
    meetingInstances: "Past meetings", userHubCalendar: "UserHub calendar",
  };
  const deadline = Date.now() + webexSeriesDiscoveryTimeoutMs();
  let cursor = 0;
  let completed = 0;
  const warn = (job: Job, reason: "timeout" | "failed" | "limit") => {
    warnings.add(reason === "timeout"
      ? `${labels[job.source]} lookup timed out. Upcoming occurrences may be missing.`
      : reason === "limit"
        ? `${labels[job.source]} reached its result limit. Discovery may be incomplete.`
        : `${labels[job.source]} lookup failed. Upcoming occurrences may be missing.`);
    // Deliberately omit raw errors/responses: they can contain credentials or join URLs.
    console.warn("[WebexSeries] discovery incomplete", {
      source: job.source, reason, from: job.from?.toISOString(), to: job.to?.toISOString(),
    });
  };
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const timeoutMs = deadline - Date.now();
      if (timeoutMs <= 0) { warn(job, "timeout"); continue; }
      try {
        const result = await invoke(job.tool, {
          ...job.params,
          ...(job.from && job.to ? { from_iso: job.from.toISOString(), to_iso: job.to.toISOString() } : {}),
        }, { timeoutMs });
        if (!result || typeof result !== "object" || !Array.isArray((result as Page).items) || "unexpectedShape" in result) {
          warn(job, "failed"); continue;
        }
        const page = result as Page & { rawCount?: number };
        completed++;
        if ((page.rawCount ?? page.items.length) >= job.limit) warn(job, "limit");
        if (page.siteUrl) pages[job.source].siteUrl = page.siteUrl;
        for (const item of page.items) {
          // Public endpoints can include a boundary row in both chunks.
          const start = Date.parse(String(item.start ?? ""));
          if (job.from && job.to && Number.isFinite(start) && (start < job.from.getTime() || start >= job.to.getTime())) continue;
          pages[job.source].items.push(item);
        }
      } catch (error) {
        const message = error instanceof Error ? `${error.name} ${error.message}` : "";
        warn(job, /abort|timeout|timed out/i.test(message) ? "timeout" : "failed");
      }
    }
  };
  await Promise.all([worker(), worker()]);
  if (!completed) throw new ApiError("Meeting discovery failed or timed out. Refresh to try again.", 504, "WEBEX_DISCOVERY_FAILED");
  return { ...pages, complete: warnings.size === 0, warnings: [...warnings] };
}
