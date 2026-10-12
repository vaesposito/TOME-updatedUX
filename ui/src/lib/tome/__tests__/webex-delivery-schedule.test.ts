import { isValidTimezone, nextDigestRun } from "../webex-delivery.server";

jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn() }));

/** The zone an hour is read in is the whole point, so each case names one. */
function rule(
  overrides: Partial<{
    cadence: "immediate" | "daily" | "weekly";
    hour: number;
    weekday: number;
    timezone: string;
  }> = {},
) {
  return {
    cadence: "daily" as const,
    hour: 9,
    weekday: 1,
    timezone: "UTC",
    ...overrides,
  };
}

describe("isValidTimezone", () => {
  it("accepts an IANA zone", () => {
    expect(isValidTimezone("Europe/Rome")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
  });

  // The zone arrives from a browser and is used inside the scheduler loop,
  // where a throw would stop every other reader's digest.
  it("rejects anything it cannot resolve", () => {
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("../../etc/localtime")).toBe(false);
  });
});

describe("nextDigestRun", () => {
  it("has no next run for immediate delivery", () => {
    expect(
      nextDigestRun(rule({ cadence: "immediate" }), new Date("2026-03-02T10:00:00Z")),
    ).toBeUndefined();
  });

  it("finds today's slot when it is still ahead", () => {
    expect(nextDigestRun(rule({ hour: 9 }), new Date("2026-03-02T07:00:00Z"))).toBe(
      "2026-03-02T09:00:00.000Z",
    );
  });

  it("rolls to tomorrow once today's slot has passed", () => {
    expect(nextDigestRun(rule({ hour: 9 }), new Date("2026-03-02T09:30:00Z"))).toBe(
      "2026-03-03T09:00:00.000Z",
    );
  });

  // A rule saved a minute before its own slot should still catch it rather
  // than waiting a whole cycle.
  it("still catches a slot that is minutes away", () => {
    expect(nextDigestRun(rule({ hour: 9 }), new Date("2026-03-02T08:59:00Z"))).toBe(
      "2026-03-02T09:00:00.000Z",
    );
  });

  it("means the hour in the reader's zone, not the server's", () => {
    // 09:00 in Rome is 08:00 UTC in winter.
    expect(
      nextDigestRun(
        rule({ hour: 9, timezone: "Europe/Rome" }),
        new Date("2026-01-15T00:00:00Z"),
      ),
    ).toBe("2026-01-15T08:00:00.000Z");
  });

  // The offset changes twice a year and a digest promised for 9am has to
  // keep arriving at 9am across the change.
  it("tracks a daylight-saving shift", () => {
    // Rome moves to UTC+2 on 2026-03-29, so the same 09:00 is 07:00 UTC.
    expect(
      nextDigestRun(
        rule({ hour: 9, timezone: "Europe/Rome" }),
        new Date("2026-03-30T00:00:00Z"),
      ),
    ).toBe("2026-03-30T07:00:00.000Z");
  });

  // Not every zone is a whole hour from UTC, so an hourly walk would never
  // land on local minute zero for readers in these.
  it("lands on the hour in a half-hour-offset zone", () => {
    expect(
      nextDigestRun(
        rule({ hour: 9, timezone: "Asia/Kolkata" }),
        new Date("2026-03-02T00:00:00Z"),
      ),
    ).toBe("2026-03-02T03:30:00.000Z");
  });

  it("lands on the hour in a three-quarter-hour-offset zone", () => {
    expect(
      nextDigestRun(
        rule({ hour: 9, timezone: "Asia/Kathmandu" }),
        new Date("2026-03-02T00:00:00Z"),
      ),
    ).toBe("2026-03-02T03:15:00.000Z");
  });

  describe("weekly", () => {
    // 2026-03-02 is a Monday.
    it("finds the chosen weekday", () => {
      expect(
        nextDigestRun(
          rule({ cadence: "weekly", weekday: 3, hour: 9 }),
          new Date("2026-03-02T10:00:00Z"),
        ),
      ).toBe("2026-03-04T09:00:00.000Z");
    });

    it("rolls a week on when the slot has just passed", () => {
      expect(
        nextDigestRun(
          rule({ cadence: "weekly", weekday: 1, hour: 9 }),
          new Date("2026-03-02T09:30:00Z"),
        ),
      ).toBe("2026-03-09T09:00:00.000Z");
    });

    it("handles Sunday, which is weekday zero", () => {
      expect(
        nextDigestRun(
          rule({ cadence: "weekly", weekday: 0, hour: 18 }),
          new Date("2026-03-02T10:00:00Z"),
        ),
      ).toBe("2026-03-08T18:00:00.000Z");
    });
  });

  it("has no next run for a zone it cannot resolve", () => {
    expect(
      nextDigestRun(
        rule({ timezone: "Nowhere/Fictional" }),
        new Date("2026-03-02T07:00:00Z"),
      ),
    ).toBeUndefined();
  });
});
