import {
  TOME_SETTINGS_GROUPS,
  groupForTab,
  subtabId,
  visibleSubtabs,
} from "@/lib/tome/settings-nav";

const ALL_SOURCES = ["github", "confluence", "webex", "sharepoint", "myagent"];

describe("settings groups", () => {
  it("names every panel the flat strip did", () => {
    const covered = new Set(
      TOME_SETTINGS_GROUPS.flatMap((group) => group.subtabs.map((s) => s.value)),
    );
    for (const value of [
      "general",
      "organization",
      "projects",
      "sources",
      "models",
      "auto-ingest",
      "review",
      "slt",
      "feed",
      "reports",
    ]) {
      expect(covered.has(value)).toBe(true);
    }
  });

  it("puts each panel in exactly one group", () => {
    const seen = new Map<string, string>();
    for (const group of TOME_SETTINGS_GROUPS) {
      for (const subtab of group.subtabs) {
        const previous = seen.get(subtabId(subtab));
        expect(previous).toBeUndefined();
        seen.set(subtabId(subtab), group.id);
      }
    }
  });

  it("keeps every group small enough to read", () => {
    for (const group of TOME_SETTINGS_GROUPS) {
      expect(group.subtabs.length).toBeGreaterThan(0);
      expect(group.subtabs.length).toBeLessThanOrEqual(6);
    }
  });
});

describe("visibleSubtabs", () => {
  it("offers a connector only where the deployment has one", () => {
    const sources = TOME_SETTINGS_GROUPS.find((g) => g.id === "sources")!;
    const labels = visibleSubtabs(sources, {
      container: false,
      sourceKinds: ["github"],
    }).map((s) => s.label);
    expect(labels).toEqual(["GitHub", "Auto-ingest"]);
  });

  it("shows child projects only on a container", () => {
    const general = TOME_SETTINGS_GROUPS.find((g) => g.id === "general")!;
    const onArea = visibleSubtabs(general, {
      container: true,
      sourceKinds: ALL_SOURCES,
    }).map((s) => s.value);
    const onProject = visibleSubtabs(general, {
      container: false,
      sourceKinds: ALL_SOURCES,
    }).map((s) => s.value);
    expect(onArea).toContain("projects");
    expect(onProject).not.toContain("projects");
  });

  it("shows the activity feed only on a project", () => {
    const ui = TOME_SETTINGS_GROUPS.find((g) => g.id === "ui")!;
    expect(
      visibleSubtabs(ui, { container: true, sourceKinds: [] }).map((s) => s.value),
    ).toEqual(["reports"]);
    expect(
      visibleSubtabs(ui, { container: false, sourceKinds: [] }).map((s) => s.value),
    ).toContain("feed");
  });

  it("never leaves a group with nothing to open", () => {
    for (const group of TOME_SETTINGS_GROUPS) {
      for (const container of [true, false]) {
        expect(
          visibleSubtabs(group, { container, sourceKinds: [] }).length,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe("groupForTab", () => {
  // The links written for the flat strip are still in the codebase, so they
  // have to land somewhere rather than falling back to the first group.
  it.each([
    ["auto-ingest", "sources"],
    ["review", "content"],
    ["slt", "content"],
    ["reports", "ui"],
    ["organization", "general"],
  ])("opens %s inside %s", (tab, group) => {
    expect(groupForTab(tab)?.group.id).toBe(group);
  });

  it("resolves a shared panel to its first connector", () => {
    const found = groupForTab("sources");
    expect(found?.group.id).toBe("sources");
    expect(found?.subtab.focus).toBe("github");
  });

  it("does not guess at a panel it has never heard of", () => {
    expect(groupForTab("not-a-tab")).toBeNull();
  });
});

describe("subtabId", () => {
  it("tells apart the subtabs that share a panel", () => {
    expect(subtabId({ value: "sources", label: "Webex", focus: "webex" })).toBe(
      "sources:webex",
    );
    expect(subtabId({ value: "review", label: "Review" })).toBe("review");
  });
});

describe("the sources fallback", () => {
  const sources = TOME_SETTINGS_GROUPS.find((g) => g.id === "sources")!;

  it("keeps the connections panel reachable with nothing configured", () => {
    expect(
      visibleSubtabs(sources, { container: false, sourceKinds: [] }).map(
        (s) => s.label,
      ),
    ).toEqual(["Connections", "Auto-ingest"]);
  });

  it("stands down as soon as one connector exists", () => {
    expect(
      visibleSubtabs(sources, { container: false, sourceKinds: ["webex"] }).map(
        (s) => s.label,
      ),
    ).toEqual(["Webex", "Auto-ingest"]);
  });
});
