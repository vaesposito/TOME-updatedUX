import {
  asPagePath,
  pageDisplayName,
  pageDisplayPath,
} from "@/lib/tome/page-names";

describe("pageDisplayName", () => {
  it("names the page by its leaf, without the extension", () => {
    expect(pageDisplayName("charter.md")).toBe("charter");
    expect(pageDisplayName("repos/example-service/team.md")).toBe("team");
  });

  it("keeps dots that belong to the name", () => {
    expect(pageDisplayName("meetings/17.08.2026.md")).toBe("17.08.2026");
  });

  it("leaves a path that carries no extension alone", () => {
    expect(pageDisplayName("glossary")).toBe("glossary");
  });
});

describe("pageDisplayPath", () => {
  it("keeps the folders that tell two same-named pages apart", () => {
    expect(pageDisplayPath("repos/example-service/overview.md")).toBe(
      "repos/example-service/overview",
    );
  });
});

describe("asPagePath", () => {
  it("gives a typed name the extension the store requires", () => {
    expect(asPagePath("roadmap")).toBe("roadmap.md");
    expect(asPagePath("  roadmap  ")).toBe("roadmap.md");
  });

  it("does not double an extension someone typed anyway", () => {
    expect(asPagePath("roadmap.md")).toBe("roadmap.md");
    expect(asPagePath("roadmap.mdx")).toBe("roadmap.mdx");
  });

  it("has nothing to make a path out of when nothing was typed", () => {
    expect(asPagePath("   ")).toBe("");
  });
});
