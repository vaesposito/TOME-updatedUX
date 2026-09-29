import { queryWebexMeetingSeries, webexOccurrenceWindows, webexSeriesDiscoveryTimeoutMs } from "../webex-series-discovery";
import { occurrenceDiscoveryLabel } from "../webex-series-discovery-options";

const now = new Date("2026-09-28T14:30:00Z");
const from = new Date("2026-09-26T14:30:00Z");
const to = new Date("2026-10-05T14:30:00Z");

describe("bounded Webex series discovery", () => {
  beforeEach(() => { jest.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { jest.restoreAllMocks(); });

  it("defaults to 45 seconds and bounds configured deadlines", () => {
    expect(webexSeriesDiscoveryTimeoutMs(undefined)).toBe(45000);
    expect(webexSeriesDiscoveryTimeoutMs("60000")).toBe(60000);
    expect(webexSeriesDiscoveryTimeoutMs("invalid")).toBe(45000);
    expect(webexSeriesDiscoveryTimeoutMs("999999")).toBe(120000);
  });

  it.each([7, 14, 30, 90])("covers the full %s-day horizon without gaps in at most seven-day segments", (days) => {
    const end = new Date(now.getTime() + days * 86400000);
    const windows = webexOccurrenceWindows(from, end);
    expect(windows[0].from).toEqual(from);
    expect(windows.at(-1)?.to).toEqual(end);
    windows.forEach((window, index) => {
      expect(window.to.getTime() - window.from.getTime()).toBeLessThanOrEqual(7 * 86400000);
      if (index) expect(window.from).toEqual(windows[index - 1].to);
    });
  });

  it("fetches templates once, limits concurrency to two, and only queries actual meetings in the past", async () => {
    let active = 0;
    let maxActive = 0;
    const invoke = jest.fn(async (_tool, _params, _options) => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--; return { items: [] };
    });
    const result = await queryWebexMeetingSeries(invoke, { from, to, now });
    expect(maxActive).toBe(2);
    expect(result.complete).toBe(true);
    expect(invoke.mock.calls.filter(([,p]) => p.meeting_type === "meetingSeries")).toHaveLength(1);
    expect(invoke.mock.calls).toHaveLength(6);
    for (const [,params, options] of invoke.mock.calls) {
      expect(options.timeoutMs).toBeGreaterThan(15000);
      expect(options.timeoutMs).toBeLessThanOrEqual(45000);
      if (params.meeting_type === "meetingSeries") expect(params.from_iso).toBeUndefined();
      else expect(Date.parse(params.to_iso) - Date.parse(params.from_iso)).toBeLessThanOrEqual(7 * 86400000);
      if (params.meeting_type === "meeting") expect(params.to_iso).toBe(now.toISOString());
    }
  });

  it("retains successful series with explicit warnings when calendar requests time out", async () => {
    const invoke = jest.fn(async (tool, params) => {
      if (tool === "webex_userhub_calendar") throw new DOMException("Aborted", "AbortError");
      return { items: params.meeting_type === "meetingSeries" ? [{ id: "series-1" }] : [] };
    });
    const result = await queryWebexMeetingSeries(invoke, { from, to, now });
    expect(result.meetingSeries.items).toEqual([{ id: "series-1" }]);
    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual(["UserHub calendar lookup timed out. Upcoming occurrences may be missing."]);
    expect(occurrenceDiscoveryLabel(undefined, 7, result.complete)).toMatch(/unknown/);
  });

  it("reports truncated and malformed results instead of a complete empty calendar", async () => {
    const invoke = jest.fn(async (tool, params) => {
      if (tool === "webex_userhub_calendar") return { items: [], rawCount: 500 };
      if (params.meeting_type === "scheduledMeeting") return { unexpectedShape: {}, items: [] };
      return { items: [] };
    });
    const result = await queryWebexMeetingSeries(invoke, { from, to, now });
    expect(result.complete).toBe(false);
    expect(result.warnings.some((message) => message.includes("result limit"))).toBe(true);
    expect(result.warnings.some((message) => message.includes("Scheduled meetings lookup failed"))).toBe(true);
  });

  it("stops launching requests after the shared deadline, with no automatic retries", async () => {
    let clock = 0;
    jest.spyOn(Date, "now").mockImplementation(() => clock);
    const invoke = jest.fn(async () => { clock = 45001; return { items: [] }; });
    const result = await queryWebexMeetingSeries(invoke, { from, to, now });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.complete).toBe(false);
    expect(result.warnings.join(" ")).toContain("timed out");
  });

  it("fails explicitly if every source fails", async () => {
    await expect(queryWebexMeetingSeries(async () => { throw new Error("unavailable"); }, { from, to, now }))
      .rejects.toMatchObject({ code: "WEBEX_DISCOVERY_FAILED" });
  });

  it("does not keep an inclusive boundary row twice", async () => {
    const boundary = "2026-10-03T00:00:00.000Z";
    const invoke = jest.fn(async (_tool, params) => ({ items: params.meeting_type === "scheduledMeeting" ? [{ id: "boundary", start: boundary }] : [] }));
    const result = await queryWebexMeetingSeries(invoke, { from, to, now });
    expect(result.scheduledMeetings.items).toEqual([{ id: "boundary", start: boundary }]);
  });
});
