import {
  DEFAULT_FOLLOW_LEVEL,
  FOLLOW_LEVELS,
  followLevelSummary,
  isFollowing,
  levelFromWatching,
} from "@/lib/tome/follow-levels";
import {
  channelsLabel,
  defaultPreferences,
  labelFor,
  CADENCES,
  sharedValue,
  spacePreference,
  timezoneOptions,
} from "@/lib/tome/notification-preferences";

describe("follow levels", () => {
  it("offers the loud levels before the quiet one", () => {
    expect(FOLLOW_LEVELS.map((level) => level.id)).toEqual([
      "everything",
      "important",
      "mentions",
      "off",
    ]);
  });

  it("treats everything but off as hearing something", () => {
    expect(isFollowing("everything")).toBe(true);
    expect(isFollowing("important")).toBe(true);
    expect(isFollowing("mentions")).toBe(true);
    expect(isFollowing("off")).toBe(false);
  });

  it("reads a plain subscription as the loudest level", () => {
    // Watching is stored as a yes or no. Showing a watcher "Important" would
    // imply a filter nothing applies, so they are shown what they do get.
    expect(levelFromWatching(true)).toBe(DEFAULT_FOLLOW_LEVEL);
    expect(levelFromWatching(true)).toBe("everything");
    expect(levelFromWatching(false)).toBe("off");
  });

  it("says where a reader stands in the menu's heading", () => {
    expect(followLevelSummary("off")).toBe("Not following");
    expect(followLevelSummary("important")).toBe("Following · Important");
  });
});

describe("notification preferences", () => {
  it("starts a reader on everything, in the bell, in real time", () => {
    const prefs = defaultPreferences("Europe/Paris");
    expect(prefs.enabled).toBe(true);
    expect(prefs.level).toBe("everything");
    expect(prefs.channels).toEqual(["bell"]);
    expect(prefs.cadence).toBe("realtime");
    expect(prefs.quietHours).toEqual({
      enabled: false,
      from: 22,
      to: 7,
      timezone: "Europe/Paris",
    });
    expect(prefs.spaces).toEqual({});
  });

  it("falls a space back to the global setting until it is changed", () => {
    const prefs = defaultPreferences("UTC");
    expect(spacePreference(prefs, "example-area")).toEqual({
      level: "everything",
      channels: ["bell"],
      cadence: "realtime",
    });

    const changed = {
      ...prefs,
      spaces: { "example-area": { level: "mentions" as const, channels: [], cadence: "weekly" as const } },
    };
    expect(spacePreference(changed, "example-area").level).toBe("mentions");
    expect(spacePreference(changed, "example-project").level).toBe("everything");
  });

  it("reports a column as shared only when every row agrees", () => {
    expect(sharedValue(["realtime", "realtime"])).toBe("realtime");
    expect(sharedValue(["realtime", "weekly"])).toBeNull();
    expect(sharedValue([])).toBeNull();
  });

  it("names the channels a reader picked, and says Off for none", () => {
    expect(channelsLabel(["bell"])).toBe("App bell");
    expect(channelsLabel(["bell", "webex"])).toBe("App bell, Webex");
    expect(channelsLabel(["webex", "bell"])).toBe("App bell, Webex");
    expect(channelsLabel([])).toBe("Off");
  });

  it("puts the reader's own zone first and never twice", () => {
    const paris = timezoneOptions("Europe/Paris");
    expect(paris[0]).toBe("Europe/Paris");
    expect(paris.filter((zone) => zone === "Europe/Paris")).toHaveLength(1);

    const kolkata = timezoneOptions("Asia/Kolkata");
    expect(kolkata[0]).toBe("Asia/Kolkata");
    expect(kolkata).toContain("UTC");
  });

  it("looks a label up by its id", () => {
    expect(labelFor(CADENCES, "weekly")).toBe("Weekly digest");
  });
});
