import {
  BUILT_IN_FUNCTIONS,
  addCategory,
  addFunction,
  defaultTaxonomy,
  hasCategoryNamed,
  normaliseTaxonomy,
  placementsOf,
  relatedSpaces,
  removeCategory,
  removeFunction,
  renameCategory,
  setSpaces,
  spacesInFunction,
  toggleSpace,
  type FunctionTaxonomy,
} from "@/lib/projects/function-taxonomy";

/** The id the library derives for a built-in, so tests can address one. */
function idOf(taxonomy: FunctionTaxonomy, name: string): string {
  return taxonomy.functions.find((fn) => fn.name === name)!.id;
}

describe("function taxonomy", () => {
  it("ships the organisation's parts with nothing guessed inside them", () => {
    const taxonomy = defaultTaxonomy();

    expect(taxonomy.functions.map((fn) => fn.name)).toEqual([
      ...BUILT_IN_FUNCTIONS,
    ]);
    // What a function calls its own divisions is not something this code can
    // know, and a guessed set would have to be deleted before the right one
    // could be made.
    expect(taxonomy.functions.every((fn) => fn.categories.length === 0)).toBe(true);
  });

  it("puts a category under one function and leaves the rest alone", () => {
    const base = defaultTaxonomy();
    const marketing = idOf(base, "Marketing");

    const { taxonomy, id } = addCategory(base, marketing, "Creative Hub");

    expect(id).toBeTruthy();
    expect(hasCategoryNamed(taxonomy, marketing, "creative hub")).toBe(true);
    expect(hasCategoryNamed(taxonomy, idOf(base, "Engineering"), "Creative Hub"))
      .toBe(false);
  });

  it("folds a second category of the same name into the first", () => {
    const base = defaultTaxonomy();
    const marketing = idOf(base, "Marketing");
    const once = addCategory(base, marketing, "Events", ["first-space"]);
    const twice = addCategory(once.taxonomy, marketing, "  events  ", ["second-space"]);

    const fn = twice.taxonomy.functions.find((f) => f.id === marketing)!;
    expect(fn.categories).toHaveLength(1);
    // The spaces of both, because the reader meant to add to the one that
    // was already there.
    expect(fn.categories[0].spaces).toEqual(["first-space", "second-space"]);
  });

  it("adds a function once, however it was capitalised", () => {
    const first = addFunction(defaultTaxonomy(), "Developer Relations");
    const second = addFunction(first.taxonomy, "developer relations");

    expect(first.taxonomy.functions).toHaveLength(BUILT_IN_FUNCTIONS.length + 1);
    expect(second.taxonomy.functions).toHaveLength(BUILT_IN_FUNCTIONS.length + 1);
    expect(second.id).toBe(first.id);
  });

  it("keeps the five that ship and drops the ones that were added", () => {
    const { taxonomy, id } = addFunction(defaultTaxonomy(), "Developer Relations");

    expect(removeFunction(taxonomy, id).functions).toHaveLength(
      BUILT_IN_FUNCTIONS.length,
    );
    expect(
      removeFunction(taxonomy, idOf(taxonomy, "Marketing")).functions,
    ).toHaveLength(BUILT_IN_FUNCTIONS.length + 1);
  });

  it("tags and untags a space from the same call", () => {
    const base = defaultTaxonomy();
    const { taxonomy, id } = addCategory(base, idOf(base, "Marketing"), "Events");

    const tagged = toggleSpace(taxonomy, id, "example-project");
    expect(placementsOf(tagged, "example-project")).toEqual([
      expect.objectContaining({
        functionName: "Marketing",
        categoryName: "Events",
      }),
    ]);

    expect(placementsOf(toggleSpace(tagged, id, "example-project"), "example-project"))
      .toEqual([]);
  });

  it("counts a space once in a function however many of its categories hold it", () => {
    const base = defaultTaxonomy();
    const marketing = idOf(base, "Marketing");
    const one = addCategory(base, marketing, "Events", ["example-project"]);
    const two = addCategory(one.taxonomy, marketing, "Webinars", ["example-project"]);

    const fn = two.taxonomy.functions.find((f) => f.id === marketing)!;
    expect(spacesInFunction(fn)).toEqual(["example-project"]);
  });

  it("relates the spaces sharing a category, never a space to itself", () => {
    const base = defaultTaxonomy();
    const { taxonomy } = addCategory(base, idOf(base, "Marketing"), "Events", [
      "first-space",
      "second-space",
      "third-space",
    ]);

    expect(relatedSpaces(taxonomy, "first-space")).toEqual([
      { slug: "second-space", through: ["Events"] },
      { slug: "third-space", through: ["Events"] },
    ]);
    expect(relatedSpaces(taxonomy, "other-space")).toEqual([]);
  });

  it("names a pair once, through every category they share", () => {
    const base = defaultTaxonomy();
    const marketing = idOf(base, "Marketing");
    const one = addCategory(base, marketing, "Events", ["first-space", "second-space"]);
    const two = addCategory(one.taxonomy, marketing, "Webinars", [
      "first-space",
      "second-space",
    ]);

    expect(relatedSpaces(two.taxonomy, "first-space")).toEqual([
      { slug: "second-space", through: ["Events", "Webinars"] },
    ]);
  });

  it("renames a category without disturbing what it holds", () => {
    const base = defaultTaxonomy();
    const { taxonomy, id } = addCategory(base, idOf(base, "Marketing"), "Events", [
      "example-project",
    ]);

    const renamed = renameCategory(taxonomy, id, "Field Events");
    expect(placementsOf(renamed, "example-project")[0].categoryName).toBe(
      "Field Events",
    );
  });

  it("takes the tags with the category when it goes", () => {
    const base = defaultTaxonomy();
    const { taxonomy, id } = addCategory(base, idOf(base, "Marketing"), "Events", [
      "example-project",
    ]);

    expect(placementsOf(removeCategory(taxonomy, id), "example-project")).toEqual([]);
  });

  it("replaces what a category holds without keeping repeats", () => {
    const base = defaultTaxonomy();
    const { taxonomy, id } = addCategory(base, idOf(base, "Marketing"), "Events");

    const filled = setSpaces(taxonomy, id, ["a-space", "a-space", "b-space"]);
    expect(filled.functions.flatMap((f) => f.categories)[0].spaces).toEqual([
      "a-space",
      "b-space",
    ]);
  });

  describe("reading a stored copy", () => {
    it("gives back the organisation when there is nothing to read", () => {
      expect(normaliseTaxonomy(undefined).functions.map((f) => f.name)).toEqual([
        ...BUILT_IN_FUNCTIONS,
      ]);
      expect(normaliseTaxonomy("not a taxonomy").functions).toHaveLength(
        BUILT_IN_FUNCTIONS.length,
      );
    });

    it("keeps the categories a stored function had", () => {
      const base = defaultTaxonomy();
      const { taxonomy } = addCategory(base, idOf(base, "Marketing"), "Events", [
        "example-project",
      ]);

      const read = normaliseTaxonomy(JSON.parse(JSON.stringify(taxonomy)));
      expect(placementsOf(read, "example-project")[0].categoryName).toBe("Events");
    });

    it("puts back a function the stored copy never had", () => {
      const read = normaliseTaxonomy({
        functions: [{ id: "marketing", name: "Marketing", categories: [] }],
      });

      expect(read.functions.map((f) => f.name)).toEqual([...BUILT_IN_FUNCTIONS]);
    });

    it("lists the ones that ship first, then the ones that were added", () => {
      const { taxonomy } = addFunction(defaultTaxonomy(), "Developer Relations");
      const read = normaliseTaxonomy(JSON.parse(JSON.stringify(taxonomy)));

      expect(read.functions.map((f) => f.name)).toEqual([
        ...BUILT_IN_FUNCTIONS,
        "Developer Relations",
      ]);
    });

    it("drops an entry it cannot make sense of rather than the page", () => {
      const read = normaliseTaxonomy({
        functions: [
          null,
          { name: "   " },
          {
            id: "dev-rel",
            name: "Developer Relations",
            categories: [{ name: "Talks", spaces: ["a-space", 7, "a-space"] }],
          },
        ],
      });

      const added = read.functions.find((f) => f.name === "Developer Relations")!;
      expect(added.categories[0].spaces).toEqual(["a-space"]);
      expect(read.functions).toHaveLength(BUILT_IN_FUNCTIONS.length + 1);
    });
  });
});
