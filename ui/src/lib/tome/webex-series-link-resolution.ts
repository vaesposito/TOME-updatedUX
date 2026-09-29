import type { Invoke } from "./webex-meeting-series";
import {
  compatibleSeriesMetadata,
  normalizedSeriesWebLink,
  type MeetingSeriesIdentity,
} from "./webex-meeting-series-identity";

type Row = Record<string, unknown>;
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

/** Resolve conflicting join-link aliases, not every meeting in the calendar. */
export async function resolveCalendarSeriesLinks(input: {
  invoke: Invoke;
  publicRows: Row[];
  calendarRows: Row[];
  deadline: number;
}): Promise<{ seriesIds: Map<string, string>; warnings: string[] }> {
  const publicIdentities: MeetingSeriesIdentity[] = input.publicRows.flatMap((row) => {
    const id = text(row.meetingSeriesId) || text(row.seriesId) ||
      (row.meetingType === "meetingSeries" ? text(row.id) : "");
    return id ? [{
      seriesKey: `webex:${id}`, title: text(row.title),
      hostEmail: text(row.hostEmail) || text(row.organizerEmail),
      sourceRefs: { meetingSeriesId: id, webLink: text(row.webLink) },
    }] : [];
  });
  const links = new Set<string>();
  for (const row of input.calendarRows) {
    const link = normalizedSeriesWebLink(text(row.webLink));
    if (!link) continue;
    const calendar: MeetingSeriesIdentity = {
      seriesKey: "", title: text(row.subject),
      hostEmail: text(row.organizerEmail) || text(row.hostEmail),
      sourceRefs: { webLink: link },
    };
    if (publicIdentities.some((candidate) =>
      compatibleSeriesMetadata(candidate, { ...calendar, sourceRefs: {} }) &&
      !compatibleSeriesMetadata(candidate, calendar),
    )) links.add(link);
  }

  const seriesIds = new Map<string, string>();
  const warnings = new Set<string>();
  const pending = [...links];
  let cursor = 0;
  const unresolved = (reason: "timeout" | "failed" | "ambiguous") => {
    warnings.add("Some meeting links could not be verified. Duplicate entries may remain; refresh to try again.");
    // Never log private join links or raw upstream error responses.
    console.warn("[WebexSeries] link identity unresolved", { reason });
  };
  const worker = async () => {
    while (cursor < pending.length) {
      const link = pending[cursor++];
      const timeoutMs = input.deadline - Date.now();
      if (timeoutMs <= 0) { unresolved("timeout"); continue; }
      try {
        const result = await input.invoke("webex_resolve_meeting_link", {
          web_link: link, max_results: 100,
        }, { timeoutMs });
        const items = result && typeof result === "object" && "items" in result ? result.items : undefined;
        if (!Array.isArray(items) || items.length === 0 || items.length >= 100) {
          unresolved("ambiguous"); continue;
        }
        const ids = items.map((row: Row | null) => {
          if (!row || typeof row !== "object") return "";
          return text(row.meetingSeriesId) || (row.meetingType === "meetingSeries" ? text(row.id) : "");
        });
        // A personal-room link may resolve to several series. Never pick one
        // by title, response order, or a partially identified result set.
        if (ids.some((id) => !id) || new Set(ids).size !== 1) {
          unresolved("ambiguous"); continue;
        }
        seriesIds.set(link, ids[0]);
      } catch (error) {
        const message = error instanceof Error ? `${error.name} ${error.message}` : "";
        unresolved(/abort|timeout|timed out/i.test(message) ? "timeout" : "failed");
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return { seriesIds, warnings: [...warnings] };
}
