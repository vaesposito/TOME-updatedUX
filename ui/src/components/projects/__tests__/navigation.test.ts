import {
  activeTomeNavigationId,
  TOME_GROUPS,
} from "@/components/projects/navigation";

describe("TOME application navigation", () => {
  it("offers the five ways into TOME, in reading order", () => {
    expect(TOME_GROUPS.flatMap((group) => group.items).map((item) => item.label)).toEqual([
      "By project",
      "By function",
      "Overview",
      "Digest",
      "Settings",
    ]);
  });

  it("gives every destination somewhere to go", () => {
    for (const item of TOME_GROUPS.flatMap((group) => group.items)) {
      expect(item.href).toBeTruthy();
    }
  });

  describe("activeTomeNavigationId", () => {
    it("tells the four views of one route apart by their query", () => {
      expect(activeTomeNavigationId("/projects", {})).toBe("projects");
      expect(activeTomeNavigationId("/projects", { tab: "functions" })).toBe("functions");
      expect(activeTomeNavigationId("/projects", { tab: "overview" })).toBe("overview");
      expect(activeTomeNavigationId("/projects", { tab: "digest" })).toBe("digest");
      expect(activeTomeNavigationId("/projects/admin", {})).toBe("settings");
    });

    it("still marks the function view for a link written before it was one", () => {
      expect(activeTomeNavigationId("/projects", { groupBy: "function" })).toBe("functions");
    });

    it("keeps the catalogue marked while the reader is inside a space", () => {
      // The catalogue is how they got there, so leaving every row unmarked
      // would say TOME is not where they are.
      expect(
        activeTomeNavigationId("/projects/example-project/tome/wiki", {}),
      ).toBe("projects");
    });

    it("marks nothing outside TOME", () => {
      expect(activeTomeNavigationId("/skills", {})).toBe("");
      expect(activeTomeNavigationId(null, {})).toBe("");
    });
  });
});
