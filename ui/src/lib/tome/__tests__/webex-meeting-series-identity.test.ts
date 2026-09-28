import { meetingSeriesMatches, normalizeMeetingSeries } from "../webex-meeting-series";
import {
  findMatchingMeetingSeries,
  normalizedSeriesWebLink,
  type MeetingSeriesIdentity,
} from "../webex-meeting-series-identity";

jest.mock("@/lib/mcp-http-server-client", () => ({}));
jest.mock("@/lib/mcp-credential-headers", () => ({}));
jest.mock("@/lib/mongodb", () => ({}));
jest.mock("@/lib/projects/onboarding-providers", () => ({}));

const now = new Date("2026-09-01T12:00:00Z");
const link = (id: string) => `https://meetings.example.test/site/j.php?MTID=${id}`;
const calendarRow = (id: string, title: string, webLink = link(id)) => ({
  id: `${id}-occurrence`,
  seriesId: id,
  subject: title,
  organizerEmail: "host@example.test",
  webLink,
  start: "2026-09-02T10:00:00Z",
  end: "2026-09-02T11:00:00Z",
});
const discover = (items: ReturnType<typeof calendarRow>[], publicRows: object[] = []) =>
  normalizeMeetingSeries({
    meetingSeries: { items: publicRows },
    scheduledMeetings: { items: [] },
    meetingInstances: { items: [] },
    userHubCalendar: { items },
    now,
  });

describe("Webex series identity isolation", () => {
  it("does not match a public subscription to a different calendar series through j.php", () => {
    const [candidate] = discover([calendarRow("calendar-other", "Other review")]);
    expect(meetingSeriesMatches(candidate, {
      seriesKey: "webex:public-original",
      sourceRefs: { meetingSeriesId: "public-original", webLink: link("original") },
    })).toBe(false);
  });

  it.each([false, true])("keeps distinct calendar IDs and MTIDs separate (reverse=%s)", (reverse) => {
    const rows = [calendarRow("calendar-a", "Design review"), calendarRow("calendar-b", "Operations review")];
    const result = discover(reverse ? rows.reverse() : rows);
    expect(result).toHaveLength(2);
    for (const row of rows) {
      const candidate = result.find((item) => item.sourceRefs.userHubSeriesId === row.seriesId);
      expect(candidate?.title).toBe(row.subject);
      expect(candidate?.occurrences.map((item) => item.occurrenceKey)).toEqual([row.id]);
    }
  });

  it("keeps distinct calendar series with the same title, host, and personal room separate", () => {
    const room = "https://meetings.example.test/meet/shared-room";
    const result = discover([
      calendarRow("calendar-a", "Weekly review", room),
      calendarRow("calendar-b", "Weekly review", room),
    ]);
    expect(result).toHaveLength(2);
    expect(result.every((item) => item.occurrences.length === 1)).toBe(true);
  });

  it("does not attach an unrelated calendar series to the only public series sharing a URL path", () => {
    const result = discover([calendarRow("calendar-other", "Other review")], [{
      id: "public-original", meetingType: "meetingSeries", title: "Original review",
      hostEmail: "host@example.test", webLink: link("original"),
    }]);
    expect(result).toHaveLength(2);
    expect(result.find((item) => item.seriesKey === "webex:public-original")?.occurrences).toEqual([]);
    expect(result.find((item) => item.seriesKey === "userhub:calendar-other")?.title).toBe("Other review");
  });

  it("still groups multiple occurrences with the same durable calendar series ID", () => {
    const first = calendarRow("calendar-a", "Weekly review");
    const result = discover([first, { ...first, id: "next-occurrence", start: "2026-09-09T10:00:00Z", end: "2026-09-09T11:00:00Z" }]);
    expect(result).toHaveLength(1);
    expect(result[0].occurrences).toHaveLength(2);
  });

  it("uses distinct keys for ID-less recurring series sharing a personal room", () => {
    const room = "https://meetings.example.test/meet/shared-room";
    const rows = [
      { ...calendarRow("first", "First review", room), seriesId: "", occurrenceType: "recurring" },
      { ...calendarRow("second", "Second review", room), seriesId: "", occurrenceType: "recurring" },
    ];
    const result = discover(rows);
    expect(result).toHaveLength(2);
    expect(new Set(result.map((item) => item.seriesKey)).size).toBe(2);
    expect(result.every((item) => item.occurrences.length === 1)).toBe(true);
    expect(discover([...rows].reverse()).map((item) => item.seriesKey)).toEqual(result.map((item) => item.seriesKey));
  });

  it("does not attach two same-title calendar series to an arbitrary public series", () => {
    const room = "https://meetings.example.test/meet/shared-room";
    const rows = [calendarRow("calendar-a", "Weekly review", room), calendarRow("calendar-b", "Weekly review", room)];
    const publicRows = [{ id: "public-series", title: "Weekly review", meetingType: "meetingSeries", webLink: room }];
    for (const items of [rows, [...rows].reverse()]) {
      const result = discover(items, publicRows);
      expect(result).toHaveLength(3);
      expect(result.find((item) => item.seriesKey === "webex:public-series")?.occurrences).toEqual([]);
    }
  });
});

describe("saved series matching", () => {
  const stored: MeetingSeriesIdentity = {
    seriesKey: "webex:public-series",
    title: "Weekly review",
    hostEmail: "host@example.test",
    sourceRefs: { meetingSeriesId: "public-series", meetingNumber: "1234", webLink: link("A") },
  };
  const weak: MeetingSeriesIdentity = {
    ...stored,
    seriesKey: "userhub:calendar-series",
    sourceRefs: { userHubSeriesId: "calendar-series", meetingNumber: "1234", webLink: link("A") },
  };

  it("prefers an exact identity over earlier weak evidence, including a legitimate host rename", () => {
    const renamed = { ...stored, title: "Renamed weekly review" };
    expect(findMatchingMeetingSeries([weak, renamed], stored)).toBe(renamed);
    expect(findMatchingMeetingSeries([renamed, weak], stored)).toBe(renamed);
    expect(meetingSeriesMatches(renamed, stored)).toBe(true);
  });

  it("supports one unambiguous cross-source match corroborated by title and link", () => {
    expect(findMatchingMeetingSeries([weak], stored)).toBe(weak);
  });

  it("rejects ambiguous weak matches in either order", () => {
    const other = { ...weak, seriesKey: "userhub:calendar-other", sourceRefs: { ...weak.sourceRefs, userHubSeriesId: "calendar-other" } };
    expect(findMatchingMeetingSeries([weak, other], stored)).toBeUndefined();
    expect(findMatchingMeetingSeries([other, weak], stored)).toBeUndefined();
  });

  it.each([
    ["missing title", { title: undefined }],
    ["different title", { title: "Other meeting" }],
    ["different host", { hostEmail: "other@example.test" }],
    ["different MTID", { sourceRefs: { ...weak.sourceRefs, webLink: link("B") } }],
    ["different meeting number", { sourceRefs: { ...weak.sourceRefs, meetingNumber: "5678" } }],
  ])("rejects a weak match with %s", (_description, changes) => {
    expect(meetingSeriesMatches({ ...weak, ...changes }, stored)).toBe(false);
  });

  it.each(["meetingSeriesId", "userHubSeriesId"] as const)("never overrides conflicting %s with a room link or scheduled ID", (key) => {
    const left = { ...stored, sourceRefs: { ...stored.sourceRefs, [key]: "first", scheduledMeetingId: "shared" } };
    const right = { ...stored, sourceRefs: { ...stored.sourceRefs, [key]: "second", scheduledMeetingId: "shared" } };
    expect(meetingSeriesMatches(left, right)).toBe(false);
  });

  it("does not trust equal legacy URL-only keys without matching metadata", () => {
    const seriesKey = "userhub:https://meetings.example.test/site/j.php";
    expect(meetingSeriesMatches({ ...weak, seriesKey, title: "Other meeting" }, { ...stored, seriesKey })).toBe(false);
    expect(meetingSeriesMatches({ ...weak, seriesKey }, { ...stored, seriesKey })).toBe(true);
  });

  it("preserves a stable identity when only URL details change", () => {
    expect(meetingSeriesMatches({ ...stored, sourceRefs: { ...stored.sourceRefs, webLink: link("new") } }, stored)).toBe(true);
  });
});

describe("series link normalization", () => {
  it("normalizes only cosmetic URL differences", () => {
    expect(normalizedSeriesWebLink("https://MEETINGS.example.test/site/j.php/?x=1&MTID=AbC#fragment"))
      .toBe(normalizedSeriesWebLink("https://meetings.example.test/site/j.php?MTID=AbC&x=1"));
  });

  it("preserves identifiers, case-sensitive values, and trailing slashes in query values", () => {
    expect(normalizedSeriesWebLink(link("AbC"))).not.toBe(normalizedSeriesWebLink(link("abc")));
    expect(normalizedSeriesWebLink(link("A"))).not.toBe(normalizedSeriesWebLink(link("B")));
    expect(normalizedSeriesWebLink(link("A/"))).not.toBe(normalizedSeriesWebLink(link("A")));
    expect(normalizedSeriesWebLink("https://meetings.example.test/meet/Room"))
      .not.toBe(normalizedSeriesWebLink("https://meetings.example.test/meet/room"));
  });
});
