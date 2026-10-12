import { artifactIsImportant, pageIsImportant } from "@/lib/tome/criticality";

describe("artifactIsImportant", () => {
  it("leaves an unlabelled artifact alone", () => {
    expect(artifactIsImportant(undefined)).toBe(false);
    expect(artifactIsImportant([])).toBe(false);
  });

  // The aliases are TOME's existing ones, so a notification picks up whatever
  // spelling the artifact already uses.
  it.each([
    "critical",
    "priority:critical",
    "p0",
    "sev0",
    "tome:critical",
    "high",
    "priority/high",
    "p1",
    "needs attention",
    "tome:needs attention",
  ])("counts %s as important", (label) => {
    expect(artifactIsImportant([label])).toBe(true);
  });

  // A decision says what an item is, not how urgent it is. Counting it would
  // make every open question shout.
  it("does not treat a decision as important", () => {
    expect(artifactIsImportant(["decision"])).toBe(false);
  });

  it("lets medium and low pass quietly", () => {
    expect(artifactIsImportant(["medium"])).toBe(false);
    expect(artifactIsImportant(["p3"])).toBe(false);
  });

  it("ignores casing and padding", () => {
    expect(artifactIsImportant([" CRITICAL "])).toBe(true);
  });

  it("needs only one label to qualify", () => {
    expect(artifactIsImportant(["docs", "low", "critical"])).toBe(true);
  });
});

describe("pageIsImportant", () => {
  it("reads a frontmatter labels list", () => {
    const markdown = [
      "---",
      "title: Gateway rollout",
      "labels:",
      "  - critical",
      "  - decision",
      "---",
      "",
      "Body.",
    ].join("\n");
    expect(pageIsImportant(markdown)).toBe(true);
  });

  it("reads a scalar priority", () => {
    expect(pageIsImportant("---\ntitle: Plan\npriority: high\n---\n\nBody.")).toBe(
      true,
    );
  });

  it("leaves a page with no labels alone", () => {
    expect(pageIsImportant("---\ntitle: Plan\n---\n\nBody.")).toBe(false);
    expect(pageIsImportant("")).toBe(false);
  });
});
