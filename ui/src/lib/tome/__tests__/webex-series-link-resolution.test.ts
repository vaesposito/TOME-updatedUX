import { discoverMeetingSeriesWithDiagnostics } from "../webex-meeting-series";
import { resolveCalendarSeriesLinks } from "../webex-series-link-resolution";

jest.mock("@/lib/mcp-http-server-client", () => ({}));
jest.mock("@/lib/mcp-credential-headers", () => ({}));
jest.mock("@/lib/mongodb", () => ({}));
jest.mock("@/lib/projects/onboarding-providers", () => ({}));

const link = (mtid: string) => `https://meetings.example.test/site/j.php?MTID=${mtid}`;
const now = new Date("2026-09-28T12:00:00Z");
const window = { now, from: new Date("2026-09-26T12:00:00Z"), to: new Date("2026-10-05T12:00:00Z") };
const template = {
  id: "public-series", meetingType: "meetingSeries", title: "Architecture review",
  hostEmail: "host@example.test", webLink: link("public-invitation"),
};
const scheduled = {
  ...template, id: "public-occurrence", meetingSeriesId: template.id, meetingType: "scheduledMeeting",
  start: "2026-09-30T14:00:00Z", end: "2026-09-30T15:00:00Z",
};
const calendar = {
  id: "calendar-occurrence", seriesId: "calendar-series", subject: template.title,
  organizerEmail: template.hostEmail, webLink: link("calendar-invitation"),
  start: scheduled.start, end: scheduled.end, occurrenceType: "NoRepeat",
};

function mockInvoke(resolution: unknown, calendarRows = [calendar]) {
  return jest.fn(async (tool: string, params: Record<string, unknown>, _options?: { timeoutMs?: number }) => {
    if (tool === "webex_resolve_meeting_link") {
      if (resolution instanceof Error) throw resolution;
      return resolution;
    }
    if (tool === "webex_userhub_calendar") return { items: calendarRows };
    if (params.meeting_type === "meetingSeries") return { items: [template] };
    if (params.meeting_type === "scheduledMeeting") return { items: [scheduled] };
    return { items: [] };
  });
}

describe("verified join-link aliases", () => {
  beforeEach(() => jest.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it("merges the public and calendar invitations when different MTIDs resolve to one public series", async () => {
    const invoke = mockInvoke({ items: [scheduled] });
    const result = await discoverMeetingSeriesWithDiagnostics(invoke, window);
    expect(result.complete).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      seriesKey: "webex:public-series", title: template.title,
      sources: ["meetings_api", "userhub_calendar"],
      sourceRefs: { meetingSeriesId: template.id, userHubSeriesId: calendar.seriesId },
      nextOccurrence: { start: scheduled.start, end: scheduled.end },
    });
    expect(result.candidates[0].occurrences).toHaveLength(1);
    const lookups = invoke.mock.calls.filter(([tool]) => tool === "webex_resolve_meeting_link");
    expect(lookups).toHaveLength(1);
    expect(lookups[0][1]).toEqual({ web_link: calendar.webLink, max_results: 100 });
    expect(lookups[0][2]?.timeoutMs).toBeLessThanOrEqual(45000);
  });

  it("accepts multiple resolved occurrences only when all have the same public series ID", async () => {
    const result = await discoverMeetingSeriesWithDiagnostics(mockInvoke({
      items: [scheduled, { ...scheduled, id: "another-occurrence" }, template],
    }), window);
    expect(result.complete).toBe(true);
    expect(result.candidates).toHaveLength(1);
  });

  it("keeps genuinely different resolved series separate even with identical titles, hosts and times", async () => {
    const result = await discoverMeetingSeriesWithDiagnostics(mockInvoke({
      items: [{ ...scheduled, meetingSeriesId: "different-series" }],
    }), window);
    expect(result.complete).toBe(true);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((row) => row.sourceRefs.meetingSeriesId).sort()).toEqual(["different-series", "public-series"]);
  });

  it.each([
    ["ambiguous IDs", { items: [scheduled, { ...scheduled, meetingSeriesId: "different-series" }] }],
    ["missing identity", { items: [scheduled, { id: "unknown", meetingType: "meeting" }] }],
    ["empty response", { items: [] }],
    ["malformed response", { items: null }],
    ["capped response", { items: Array.from({ length: 100 }, () => scheduled) }],
    ["timeout", new Error("request timed out")],
    ["forbidden", new Error("HTTP 403")],
  ])("keeps uncertain rows separate with a warning on %s, without retrying", async (_case, payload) => {
    const invoke = mockInvoke(payload);
    const result = await discoverMeetingSeriesWithDiagnostics(invoke, window);
    expect(result.complete).toBe(false);
    expect(result.candidates).toHaveLength(2);
    expect(result.warnings.join(" ")).toContain("Duplicate entries may remain");
    expect(invoke.mock.calls.filter(([tool]) => tool === "webex_resolve_meeting_link")).toHaveLength(1);
    expect(JSON.stringify(jest.mocked(console.warn).mock.calls)).not.toContain(calendar.webLink);
  });

  it.each([
    ["identical links", { ...calendar, webLink: template.webLink }, 1],
    ["different titles", { ...calendar, subject: "Unrelated review" }, 2],
    ["different hosts", { ...calendar, organizerEmail: "other@example.test" }, 2],
  ])("does not add resolution requests for %s", async (_case, row, expectedCount) => {
    const invoke = mockInvoke({ items: [scheduled] }, [row]);
    const result = await discoverMeetingSeriesWithDiagnostics(invoke, window);
    expect(invoke.mock.calls.some(([tool]) => tool === "webex_resolve_meeting_link")).toBe(false);
    expect(result.candidates).toHaveLength(expectedCount);
  });

  it("does not merge distinct same-title public series just because one calendar link resolves", async () => {
    const fallback = mockInvoke({ items: [scheduled] });
    const other = { ...template, id: "other-series", webLink: link("other-public-invitation") };
    const invoke = jest.fn(async (tool: string, params: Record<string, unknown>, options?: { timeoutMs?: number }) =>
      params.meeting_type === "meetingSeries" ? { items: [other, template] } : fallback(tool, params, options),
    );
    const result = await discoverMeetingSeriesWithDiagnostics(invoke, window);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.find((row) => row.seriesKey === "webex:public-series")?.sources).toEqual(["meetings_api", "userhub_calendar"]);
    expect(result.candidates.find((row) => row.seriesKey === "webex:other-series")?.sources).toEqual(["meetings_api"]);
  });

  it("resolves each unique link once per sweep, using at most two concurrent calls", async () => {
    let active = 0;
    let maxActive = 0;
    const invoke = jest.fn(async () => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return { items: [scheduled] };
    });
    const result = await resolveCalendarSeriesLinks({
      invoke, publicRows: [template, scheduled], deadline: Date.now() + 45000,
      calendarRows: [calendar, calendar, ...["second", "third"].map((id) => ({ ...calendar, webLink: link(id) }))],
    });
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(2);
    expect(result.seriesIds.size).toBe(3);
    // This is per-sweep deduplication, not a persistent or cross-user cache.
    await resolveCalendarSeriesLinks({ invoke, publicRows: [template], calendarRows: [calendar], deadline: Date.now() + 45000 });
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("does not start link lookups after the existing discovery deadline", async () => {
    const invoke = jest.fn();
    const result = await resolveCalendarSeriesLinks({
      invoke, publicRows: [template], calendarRows: [calendar], deadline: Date.now() - 1,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.seriesIds.size).toBe(0);
    expect(result.warnings).toHaveLength(1);
  });
});
