import {
  DEFAULT_DIGEST_CONFIG,
  DIGEST_TOPIC_MAX,
  describeDigest,
  digestConfigsDiffer,
  hourLabel,
  parseDigestConfig,
  usesWeekday,
} from "@/lib/tome/digest-config";

describe("hourLabel", () => {
  it("reads the clock the way a schedule is spoken", () => {
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(9)).toBe("9 AM");
    expect(hourLabel(11)).toBe("11 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(13)).toBe("1 PM");
    expect(hourLabel(23)).toBe("11 PM");
  });
});

describe("describeDigest", () => {
  it("says the whole schedule in one line", () => {
    expect(describeDigest(DEFAULT_DIGEST_CONFIG)).toBe(
      "Every week on Monday at 9 AM",
    );
  });

  it("leaves out the day when the day means nothing", () => {
    expect(
      describeDigest({ ...DEFAULT_DIGEST_CONFIG, frequency: "daily" }),
    ).toBe("Every day at 9 AM");
  });
});

describe("usesWeekday", () => {
  it("is every frequency but daily", () => {
    expect(usesWeekday("daily")).toBe(false);
    expect(usesWeekday("weekly")).toBe(true);
    expect(usesWeekday("fortnightly")).toBe(true);
  });
});

describe("parseDigestConfig", () => {
  it("ships as Monday morning", () => {
    expect(parseDigestConfig(undefined)).toEqual(DEFAULT_DIGEST_CONFIG);
    expect(parseDigestConfig(null)).toEqual(DEFAULT_DIGEST_CONFIG);
    expect(parseDigestConfig("weekly")).toEqual(DEFAULT_DIGEST_CONFIG);
    expect(parseDigestConfig({})).toEqual(DEFAULT_DIGEST_CONFIG);
  });

  it("reads back what was stored", () => {
    expect(
      parseDigestConfig({
        topic: "Where each project stands",
        frequency: "fortnightly",
        weekday: 4,
        hour: 17,
      }),
    ).toEqual({
      topic: "Where each project stands",
      frequency: "fortnightly",
      weekday: 4,
      hour: 17,
    });
  });

  it("keeps the fields that still make sense", () => {
    // A document written by an older release, or edited by hand, should give
    // up its usable parts rather than silently resetting the lot.
    expect(
      parseDigestConfig({
        topic: "Anything waiting on a decision",
        frequency: "hourly",
        weekday: 99,
        hour: "nine",
      }),
    ).toEqual({
      topic: "Anything waiting on a decision",
      frequency: "weekly",
      weekday: 1,
      hour: 9,
    });
  });

  it("refuses an hour or a day just outside the dial", () => {
    expect(parseDigestConfig({ hour: 24 }).hour).toBe(9);
    expect(parseDigestConfig({ hour: -1 }).hour).toBe(9);
    expect(parseDigestConfig({ hour: 9.5 }).hour).toBe(9);
    expect(parseDigestConfig({ weekday: 7 }).weekday).toBe(1);
    expect(parseDigestConfig({ weekday: 0 }).weekday).toBe(0);
    expect(parseDigestConfig({ hour: 0 }).hour).toBe(0);
  });

  it("caps the topic", () => {
    // The settings endpoint stores what it is sent, so a field with no
    // ceiling is a way to grow someone's settings document without limit.
    const long = "a".repeat(DIGEST_TOPIC_MAX + 500);
    expect(parseDigestConfig({ topic: long }).topic).toHaveLength(
      DIGEST_TOPIC_MAX,
    );
  });
});

describe("digestConfigsDiffer", () => {
  it("sees a real change", () => {
    expect(
      digestConfigsDiffer(DEFAULT_DIGEST_CONFIG, {
        ...DEFAULT_DIGEST_CONFIG,
        hour: 8,
      }),
    ).toBe(true);
    expect(
      digestConfigsDiffer(DEFAULT_DIGEST_CONFIG, {
        ...DEFAULT_DIGEST_CONFIG,
        topic: "Decisions only",
      }),
    ).toBe(true);
  });

  it("ignores whitespace around the topic", () => {
    expect(
      digestConfigsDiffer(
        { ...DEFAULT_DIGEST_CONFIG, topic: " Decisions " },
        { ...DEFAULT_DIGEST_CONFIG, topic: "Decisions" },
      ),
    ).toBe(false);
  });

  it("ignores a day the frequency does not use", () => {
    // Nothing a reader can see would change, so offering them Save would be
    // offering to write the same schedule twice.
    expect(
      digestConfigsDiffer(
        { ...DEFAULT_DIGEST_CONFIG, frequency: "daily", weekday: 3 },
        { ...DEFAULT_DIGEST_CONFIG, frequency: "daily", weekday: 1 },
      ),
    ).toBe(false);
  });
});
