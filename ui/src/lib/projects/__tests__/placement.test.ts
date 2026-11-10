import {
  isHierarchySpace,
  isInCategory,
  isInFunction,
  isSubject,
  namesUsedBy,
  partitionSpaces,
  placementOf,
} from "@/lib/projects/placement";
import type { ProjectLabels } from "@/types/projects";

function space(labels: ProjectLabels) {
  return { labels };
}

describe("where a space belongs", () => {
  it("reads a space naming nothing as one on the hierarchy axis", () => {
    expect(placementOf(undefined)).toEqual({ axis: "hierarchy" });
    expect(placementOf({})).toEqual({ axis: "hierarchy" });
    expect(placementOf({ functions: [], categories: [] })).toEqual({
      axis: "hierarchy",
    });
  });

  it("reads a goal and an area as the two levels above a project", () => {
    expect(
      placementOf({ initiatives: ["example-goal"], areas: ["example-area"] }),
    ).toEqual({
      axis: "hierarchy",
      initiative: "example-goal",
      area: "example-area",
    });
  });

  it("reads a function and a category as the two levels above a subject", () => {
    expect(
      placementOf({
        functions: ["Primary Function"],
        categories: ["Example Category"],
      }),
    ).toEqual({
      axis: "function",
      function: "Primary Function",
      category: "Example Category",
    });
  });

  it("puts a subject in its function when it names no category", () => {
    expect(placementOf({ functions: ["Primary Function"] })).toEqual({
      axis: "function",
      function: "Primary Function",
    });
  });

  it("names a category nothing but a function has no axis of its own", () => {
    // A category without a function is a division of nothing, so it places
    // nothing: the record is still read on the hierarchy axis.
    expect(placementOf({ categories: ["Example Category"] })).toEqual({
      axis: "hierarchy",
    });
  });

  it("puts a record naming both axes on the function one", () => {
    const both = {
      initiatives: ["example-goal"],
      areas: ["example-area"],
      functions: ["Primary Function"],
      categories: ["Example Category"],
    };

    expect(placementOf(both)).toEqual({
      axis: "function",
      function: "Primary Function",
      category: "Example Category",
    });
    expect(isSubject(space(both))).toBe(true);
    expect(isHierarchySpace(space(both))).toBe(false);
  });

  it("reads one path, however many values a level was given", () => {
    expect(
      placementOf({
        functions: ["Primary Function", "Secondary Function"],
        categories: ["Example Category", "Second Example Category"],
      }),
    ).toEqual({
      axis: "function",
      function: "Primary Function",
      category: "Example Category",
    });
  });

  it("ignores a blank name rather than placing a space nowhere", () => {
    expect(
      placementOf({ functions: ["   "], initiatives: ["example-goal"] }),
    ).toEqual({ axis: "hierarchy", initiative: "example-goal" });
  });

  it("splits a catalogue into two disjoint lists", () => {
    const project = space({ areas: ["example-area"] });
    const subject = space({ functions: ["Primary Function"] });
    const loose = space({});

    const { hierarchy, subjects } = partitionSpaces([project, subject, loose]);

    expect(hierarchy).toEqual([project, loose]);
    expect(subjects).toEqual([subject]);
    // Nothing is in both, and nothing is dropped.
    expect(hierarchy.length + subjects.length).toBe(3);
  });

  it("matches a function and a category however they were capitalised", () => {
    const subject = space({
      functions: ["Primary Function"],
      categories: ["Example Category"],
    });

    expect(isInFunction(subject, "primary  function")).toBe(true);
    expect(isInFunction(subject, "Secondary Function")).toBe(false);
    expect(isInCategory(subject, "PRIMARY FUNCTION", "example category")).toBe(
      true,
    );
    // The same category name under a function that does not own it.
    expect(isInCategory(subject, "Secondary Function", "Example Category")).toBe(
      false,
    );
  });

  it("never matches a project against a function", () => {
    const project = space({ areas: ["primary function"] });

    expect(isInFunction(project, "Primary Function")).toBe(false);
  });

  it("names every function and category its subjects use, each once", () => {
    const used = namesUsedBy([
      space({ functions: ["Primary Function"], categories: ["Example Category"] }),
      space({ functions: ["primary function"], categories: ["example category"] }),
      space({ functions: ["Primary Function"] }),
      space({ functions: ["Secondary Function"], categories: ["Example Category"] }),
      space({ areas: ["example-area"] }),
    ]);

    expect(used).toEqual([
      { function: "Primary Function", category: "Example Category" },
      { function: "Primary Function" },
      { function: "Secondary Function", category: "Example Category" },
    ]);
  });
});
