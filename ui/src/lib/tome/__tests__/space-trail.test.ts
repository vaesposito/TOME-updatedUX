import { defaultTaxonomy, withConfiguredCategories } from "@/lib/projects/function-taxonomy";
import { spaceTrail } from "@/lib/tome/space-trail";

/** A taxonomy holding one function with one category, as a device would. */
const taxonomy = withConfiguredCategories(
  defaultTaxonomy(),
  "Example Function: Example Category",
);

const bhag = { slug: "example-goal", title: "Example Goal" };
const area = { slug: "example-area", title: "Example Area" };

describe("spaceTrail on the hierarchy axis", () => {
  it("climbs the goal and the area above a project", () => {
    expect(spaceTrail({ labels: { areas: ["Example Area"] }, taxonomy, bhag, area })).toEqual([
      { href: "/projects/example-goal/tome", title: "Example Goal", type: "bhag" },
      { href: "/projects/example-area/tome", title: "Example Area", type: "area" },
    ]);
  });

  it("has nothing to climb for a space that names nowhere", () => {
    expect(spaceTrail({ labels: undefined, taxonomy })).toEqual([]);
  });
});

describe("spaceTrail on the function axis", () => {
  it("climbs the function and category above a subject", () => {
    expect(
      spaceTrail({
        labels: {
          functions: ["Example Function"],
          categories: ["Example Category"],
        },
        taxonomy,
      }),
    ).toEqual([
      { href: "/projects?tab=functions", title: "Example Function", type: "function" },
      {
        // The category's own id, which is namespaced by its function and so
        // is not the slug of its name — which is why the names are matched
        // back against the taxonomy rather than slugified afresh.
        href: "/projects/functions/example-function--example-function-example-category",
        title: "Example Category",
        type: "category",
      },
    ]);
  });

  it("stops at the function when the subject names no category", () => {
    const trail = spaceTrail({ labels: { functions: ["Example Function"] }, taxonomy });
    expect(trail).toHaveLength(1);
    expect(trail[0].type).toBe("function");
  });

  it("names a category this device has never heard of without inventing a link", () => {
    const trail = spaceTrail({
      labels: { functions: ["Example Function"], categories: ["Unknown Category"] },
      taxonomy,
    });
    // Said, because it is what the subject claims; pointed at the function
    // list, because there is no category page to send a reader to.
    expect(trail[1]).toEqual({
      href: "/projects?tab=functions",
      title: "Unknown Category",
      type: "category",
    });
  });

  it("never names a goal above a subject, whatever the record still carries", () => {
    // Records move between the axes, and an old area tag outliving the move
    // must not put a BHAG above a space the catalogue lists as a subject.
    const trail = spaceTrail({
      labels: {
        functions: ["Example Function"],
        initiatives: ["Example Goal"],
        areas: ["Example Area"],
      },
      taxonomy,
      bhag,
      area,
    });
    expect(trail.map((row) => row.type)).toEqual(["function"]);
  });
});
