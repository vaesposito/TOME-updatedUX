import {
  BUILT_IN_FUNCTIONS,
  addCategory,
  addFunction,
  categorySlug,
  defaultTaxonomy,
  findCategoryBySlug,
  hasCategoryNamed,
  normaliseTaxonomy,
  parseConfiguredCategories,
  parseConfiguredTags,
  placementsOf,
  reconcileConfiguration,
  reconcileConfiguredCategories,
  relatedSpaces,
  removeCategory,
  removeFunction,
  renameCategory,
  setSpaces,
  spacesInFunction,
  toggleSpace,
  withConfiguredCategories,
  withConfiguredTags,
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

  describe("categories a deployment ships with", () => {
    const CONFIG =
      "Marketing: Example Campaigns, Example Field Events | Developer Relations: Example Talks";

    it("reads one line of configuration into functions and their categories", () => {
      expect(parseConfiguredCategories(CONFIG)).toEqual([
        { function: "Marketing", categories: ["Example Campaigns", "Example Field Events"] },
        { function: "Developer Relations", categories: ["Example Talks"] },
      ]);
    });

    it("reads nothing out of nothing, and out of a line with no function named", () => {
      expect(parseConfiguredCategories(undefined)).toEqual([]);
      expect(parseConfiguredCategories("")).toEqual([]);
      expect(parseConfiguredCategories("no colon here")).toEqual([]);
      expect(parseConfiguredCategories("Marketing:   ,  ")).toEqual([]);
    });

    it("puts the configured categories under the function that ships", () => {
      const seeded = withConfiguredCategories(defaultTaxonomy(), CONFIG);
      const marketing = seeded.functions.find((fn) => fn.name === "Marketing")!;

      expect(marketing.categories.map((c) => c.name)).toEqual([
        "Example Campaigns",
        "Example Field Events",
      ]);
      // Each category is addressable on its own, as one made by hand is.
      expect(new Set(marketing.categories.map((c) => c.id)).size).toBe(2);
    });

    it("creates a function configuration names that TOME does not ship", () => {
      const seeded = withConfiguredCategories(defaultTaxonomy(), CONFIG);
      const added = seeded.functions.find((fn) => fn.name === "Developer Relations")!;

      expect(added.categories.map((c) => c.name)).toEqual(["Example Talks"]);
      // Added, so it sorts after the five that ship.
      expect(seeded.functions.map((f) => f.name).at(-1)).toBe("Developer Relations");
    });

    it("adds only what is missing, keeping what was made and tagged by hand", () => {
      const base = defaultTaxonomy();
      const marketingId = idOf(base, "Marketing");
      const withOwn = addCategory(base, marketingId, "Example Campaigns", [
        "example-project",
      ]).taxonomy;

      const seeded = withConfiguredCategories(withOwn, CONFIG);
      const marketing = seeded.functions.find((fn) => fn.name === "Marketing")!;

      expect(marketing.categories.map((c) => c.name)).toEqual([
        "Example Campaigns",
        "Example Field Events",
      ]);
      expect(marketing.categories[0].spaces).toEqual(["example-project"]);
    });

    it("leaves a taxonomy alone when nothing is configured", () => {
      const base = defaultTaxonomy();
      expect(withConfiguredCategories(base, undefined)).toBe(base);
    });

    it("reads a rename in configuration as a rename, not as one more", () => {
      const seeded = withConfiguredCategories(defaultTaxonomy(), CONFIG);
      const renamed = reconcileConfiguredCategories(
        seeded,
        CONFIG,
        "Marketing: Campaigns, Field Events | Developer Relations: Example Talks",
      );

      expect(
        renamed.functions.find((fn) => fn.name === "Marketing")!.categories.map((c) => c.name),
      ).toEqual(["Campaigns", "Field Events"]);
    });

    it("keeps a retired category once a space has been tagged into it", () => {
      const seeded = withConfiguredCategories(defaultTaxonomy(), CONFIG);
      const marketingId = idOf(seeded, "Marketing");
      const used = addCategory(seeded, marketingId, "Example Campaigns", [
        "example-project",
      ]).taxonomy;

      const renamed = reconcileConfiguredCategories(
        used,
        CONFIG,
        "Marketing: Campaigns, Example Field Events",
      );
      const marketing = renamed.functions.find((fn) => fn.name === "Marketing")!;

      // Still named by nothing in configuration, but someone is using it.
      expect(marketing.categories.map((c) => c.name)).toEqual([
        "Example Campaigns",
        "Example Field Events",
        "Campaigns",
      ]);
    });

    it("takes out everything when configuration stops naming any of it", () => {
      const seeded = withConfiguredCategories(defaultTaxonomy(), CONFIG);
      const emptied = reconcileConfiguredCategories(seeded, CONFIG, undefined);

      expect(
        emptied.functions.find((fn) => fn.name === "Marketing")!.categories,
      ).toEqual([]);
    });

    it("leaves categories made by hand out of it entirely", () => {
      const base = defaultTaxonomy();
      const own = addCategory(base, idOf(base, "Engineering"), "Example Platform").taxonomy;

      const reconciled = reconcileConfiguredCategories(own, CONFIG, undefined);

      expect(
        reconciled.functions.find((fn) => fn.name === "Engineering")!.categories.map((c) => c.name),
      ).toEqual(["Example Platform"]);
    });
  });

  describe("projects a deployment puts in its categories", () => {
    const CATEGORIES = "Marketing: Example Campaigns | Engineering: Example Campaigns";
    const TAGS =
      "Marketing > Example Campaigns: first-example-project, second-example-project";

    function seeded(tags = TAGS) {
      return withConfiguredTags(
        withConfiguredCategories(defaultTaxonomy(), CATEGORIES),
        tags,
      );
    }

    function categoryIn(taxonomy: FunctionTaxonomy, fnName: string) {
      return taxonomy.functions.find((fn) => fn.name === fnName)!.categories[0];
    }

    it("reads a tagging line into a function, a category and its projects", () => {
      expect(parseConfiguredTags(TAGS)).toEqual([
        {
          function: "Marketing",
          category: "Example Campaigns",
          spaces: ["first-example-project", "second-example-project"],
        },
      ]);
    });

    it("reads nothing out of a line missing the function or the projects", () => {
      expect(parseConfiguredTags(undefined)).toEqual([]);
      expect(parseConfiguredTags("Example Campaigns: a-project")).toEqual([]);
      expect(parseConfiguredTags("Marketing > Example Campaigns:")).toEqual([]);
    });

    it("puts the projects in the named function's category, not the other's", () => {
      const taxonomy = seeded();

      expect(categoryIn(taxonomy, "Marketing").spaces).toEqual([
        "first-example-project",
        "second-example-project",
      ]);
      // Same category name under another function means something else.
      expect(categoryIn(taxonomy, "Engineering").spaces).toEqual([]);
    });

    it("ignores a tag naming a category that does not exist", () => {
      const taxonomy = withConfiguredTags(
        withConfiguredCategories(defaultTaxonomy(), CATEGORIES),
        "Marketing > Not A Category: first-example-project",
      );

      expect(categoryIn(taxonomy, "Marketing").spaces).toEqual([]);
    });

    it("keeps what someone tagged by hand beside what is configured", () => {
      const base = withConfiguredCategories(defaultTaxonomy(), CATEGORIES);
      const byHand = toggleSpace(
        base,
        categoryIn(base, "Marketing").id,
        "third-example-project",
      );

      const taxonomy = withConfiguredTags(byHand, TAGS);

      expect(categoryIn(taxonomy, "Marketing").spaces).toEqual([
        "third-example-project",
        "first-example-project",
        "second-example-project",
      ]);
    });

    it("takes out a project configuration has stopped naming, and only that one", () => {
      const before = seeded();
      const byHand = toggleSpace(
        before,
        categoryIn(before, "Marketing").id,
        "third-example-project",
      );

      const after = reconcileConfiguration(
        byHand,
        { categories: CATEGORIES, tags: TAGS },
        {
          categories: CATEGORIES,
          tags: "Marketing > Example Campaigns: first-example-project",
        },
      );

      expect(categoryIn(after, "Marketing").spaces).toEqual([
        "first-example-project",
        "third-example-project",
      ]);
    });

    it("empties a category first, so renaming both reads as a rename", () => {
      const before = seeded();

      const after = reconcileConfiguration(
        before,
        { categories: CATEGORIES, tags: TAGS },
        {
          categories: "Marketing: Campaigns | Engineering: Example Campaigns",
          tags: "Marketing > Campaigns: first-example-project",
        },
      );
      const marketing = after.functions.find((fn) => fn.name === "Marketing")!;

      expect(marketing.categories.map((c) => c.name)).toEqual(["Campaigns"]);
      expect(marketing.categories[0].spaces).toEqual(["first-example-project"]);
    });
  });

  describe("addressing a category", () => {
    /** A marketing function divided once, as a view would divide it. */
    function divided() {
      const base = defaultTaxonomy();
      return addCategory(base, idOf(base, "Marketing"), "Field Events", [
        "first-example-project",
      ]).taxonomy;
    }

    function only(taxonomy: FunctionTaxonomy) {
      const fn = taxonomy.functions.find((f) => f.categories.length > 0)!;
      return { fn, category: fn.categories[0] };
    }

    it("names the function as well as the category, so a link says which", () => {
      const { fn, category } = only(divided());

      expect(categorySlug(fn, category)).toBe(`${fn.id}--${category.id}`);
      // Neither id can hold a double dash, so the pair stays separable.
      expect(fn.id).not.toContain("--");
      expect(category.id).not.toContain("--");
    });

    it("finds the category a slug names, and the function it belongs to", () => {
      const taxonomy = divided();
      const { fn, category } = only(taxonomy);

      const found = findCategoryBySlug(taxonomy, categorySlug(fn, category));

      expect(found?.fn.name).toBe("Marketing");
      expect(found?.category.name).toBe("Field Events");
      expect(found?.category.spaces).toEqual(["first-example-project"]);
    });

    it("finds nothing for a slug this taxonomy does not hold", () => {
      const taxonomy = divided();

      expect(findCategoryBySlug(taxonomy, "marketing--nothing")).toBeNull();
      expect(findCategoryBySlug(taxonomy, "")).toBeNull();
      // The same category under a function that does not own it.
      const { category } = only(taxonomy);
      expect(
        findCategoryBySlug(taxonomy, `engineering--${category.id}`),
      ).toBeNull();
    });
  });
});
