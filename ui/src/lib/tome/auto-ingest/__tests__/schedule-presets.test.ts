// Local<->UTC round-trip for the auto-ingest schedule form. The form is
// edited in the browser's local time; the persisted cron is always UTC.
// Node doesn't reliably support switching `process.env.TZ` mid-test, so
// these assert the round-trip invariant (scheduleToCron -> cronToSchedule
// recovers the original local time) under whatever timezone the test
// runner uses, rather than pinning exact UTC cron strings to a specific zone.

import {
  cronToSchedule,
  describeSchedule,
  nextCronRun,
  scheduleToCron,
} from "../schedule-presets";

describe("scheduleToCron / cronToSchedule (local <-> UTC)", () => {
  it("round-trips a daily schedule", () => {
    const form = { preset: "daily" as const, hour: 9, minute: 30, weekday: 1, advancedCron: "" };
    const roundTripped = cronToSchedule(scheduleToCron(form));
    expect(roundTripped).toMatchObject({ preset: "daily", hour: 9, minute: 30 });
  });

  it("round-trips a weekly schedule, including across a UTC day rollover", () => {
    // 23:45 local is close enough to midnight that in most timezones the
    // UTC-equivalent lands on a different calendar day/weekday — exercises
    // the day-rollover math, whichever direction it rolls in this env.
    const form = { preset: "weekly" as const, hour: 23, minute: 45, weekday: 1, advancedCron: "" };
    const cron = scheduleToCron(form);
    const fields = cron.split(" ");
    expect(fields).toHaveLength(5);
    expect(fields[4]).toMatch(/^[0-6]$/); // a single UTC weekday digit, not "*"

    const roundTripped = cronToSchedule(cron);
    expect(roundTripped).toMatchObject({ preset: "weekly", hour: 23, minute: 45, weekday: 1 });
  });

  it("produces a plain daily cron with no day-of-week restriction", () => {
    const cron = scheduleToCron({ preset: "daily", hour: 2, minute: 15, weekday: 3, advancedCron: "" });
    const fields = cron.split(" ");
    expect(fields[2]).toBe("*"); // day-of-month
    expect(fields[3]).toBe("*"); // month
    expect(fields[4]).toBe("*"); // day-of-week — daily ignores `weekday`
  });

  it("passes advanced cron through unchanged", () => {
    expect(scheduleToCron({ preset: "advanced", hour: 0, minute: 0, weekday: 0, advancedCron: "*/15 * * * *" })).toBe(
      "*/15 * * * *",
    );
  });

  it("falls back to advanced for a cron shape the form doesn't produce", () => {
    const parsed = cronToSchedule("*/15 * * * *");
    expect(parsed.preset).toBe("advanced");
    expect(parsed.advancedCron).toBe("*/15 * * * *");
  });
});

describe("hourly", () => {
  it("compiles to a minute-only cron, with no hour to convert", () => {
    expect(
      scheduleToCron({ preset: "hourly", hour: 9, minute: 20, weekday: 3, advancedCron: "" }),
    ).toBe("20 * * * *");
  });

  it("round-trips back to the preset rather than falling through to advanced", () => {
    const roundTripped = cronToSchedule(scheduleToCron({
      preset: "hourly",
      hour: 0,
      minute: 45,
      weekday: 0,
      advancedCron: "",
    }));
    expect(roundTripped).toMatchObject({ preset: "hourly", minute: 45 });
  });

  it("is not mistaken for a daily schedule, which names an hour", () => {
    expect(cronToSchedule("0 2 * * *").preset).toBe("daily");
    expect(cronToSchedule("0 * * * *").preset).toBe("hourly");
  });

  it("says when it runs without naming a time of day", () => {
    const described = describeSchedule({
      preset: "hourly",
      hour: 9,
      minute: 5,
      weekday: 1,
      advancedCron: "",
    });
    expect(described).toBe("Hourly at 05 past");
  });

  it("previews the next run within the hour", () => {
    const from = new Date(Date.UTC(2024, 0, 1, 10, 10, 0));
    const next = nextCronRun("20 * * * *", from);
    expect(next?.toISOString()).toBe(new Date(Date.UTC(2024, 0, 1, 10, 20, 0)).toISOString());

    // And rolls into the following hour once the minute has passed.
    const after = nextCronRun("20 * * * *", new Date(Date.UTC(2024, 0, 1, 10, 30, 0)));
    expect(after?.toISOString()).toBe(new Date(Date.UTC(2024, 0, 1, 11, 20, 0)).toISOString());
  });
});
