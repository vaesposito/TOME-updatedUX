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
  reconcileConfiguredCategories,
  removeCategory,
  withConfiguredCategories,
  withSubjectNames,
  type FunctionTaxonomy,
} from "@/lib/projects/function-taxonomy";

/** The id the library derives for a built-in, so tests can address one. */
function idOf(taxonomy: FunctionTaxonomy, name: string): string {
  return taxonomy.functions.find((fn) => fn.name === name)!.id;
}

/** The category names one function keeps, in the order it keeps them. */
function categoriesOf(taxonomy: FunctionTaxonomy, name: string): string[] {
  return taxonomy.functions
    .find((fn) => fn.name === name)!
    .categories.map((c) => c.name);
}

/** A subject, as the only thing this module needs to see of one. */
function subject(fn: string, category?: string) {
  return {
    labels: { functions: [fn], ...(category ? { categories: [category] } : {}) },
  };
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
    const once = addCategory(base, marketing, "Events");
    const twice = addCategory(once.taxonomy, marketing, "  events  ");

    expect(categoriesOf(twice.taxonomy, "Marketing")).toEqual(["Events"]);
    expect(twice.id).toBe(once.id);
  });

  it("adds a function once, however it was capitalised", () => {
    const first = addFunction(defaultTaxonomy(), "Developer Relations");
    const second = addFunction(first.taxonomy, "developer relations");

    expect(first.taxonomy.functions).toHaveLength(BUILT_IN_FUNCTIONS.length + 1);
    expect(second.taxonomy.functions).toHaveLength(BUILT_IN_FUNCTIONS.length + 1);
    expect(second.id).toBe(first.id);
  });

  it("removes a category from the vocabulary", () => {
    const base = defaultTaxonomy();
    const { taxonomy, id } = addCategory(base, idOf(base, "Marketing"), "Events");

    expect(categoriesOf(removeCategory(taxonomy, id), "Marketing")).toEqual([]);
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
      const { taxonomy } = addCategory(base, idOf(base, "Marketing"), "Events");

      const read = normaliseTaxonomy(JSON.parse(JSON.stringify(taxonomy)));
      expect(categoriesOf(read, "Marketing")).toEqual(["Events"]);
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
            categories: [null, { name: "" }, { name: "Talks" }],
          },
        ],
      });

      const added = read.functions.find((f) => f.name === "Developer Relations")!;
      expect(added.categories.map((c) => c.name)).toEqual(["Talks"]);
      expect(read.functions).toHaveLength(BUILT_IN_FUNCTIONS.length + 1);
    });

    it("drops what a copy written before the split put inside a category", () => {
      // A category places nothing now, so a stored list of spaces is read as
      // a name and nothing else.
      const read = normaliseTaxonomy({
        functions: [
          {
            id: "marketing",
            name: "Marketing",
            categories: [{ id: "m-events", name: "Events", spaces: ["a-space"] }],
          },
        ],
      });

      expect(
        read.functions.find((f) => f.name === "Marketing")!.categories[0],
      ).toEqual({ id: "m-events", name: "Events" });
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

      expect(categoriesOf(seeded, "Developer Relations")).toEqual(["Example Talks"]);
      // Added, so it sorts after the five that ship.
      expect(seeded.functions.map((f) => f.name).at(-1)).toBe("Developer Relations");
    });

    it("adds only what is missing, keeping what was named by hand", () => {
      const base = defaultTaxonomy();
      const withOwn = addCategory(base, idOf(base, "Marketing"), "Example Campaigns")
        .taxonomy;

      const seeded = withConfiguredCategories(withOwn, CONFIG);

      expect(categoriesOf(seeded, "Marketing")).toEqual([
        "Example Campaigns",
        "Example Field Events",
      ]);
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

      expect(categoriesOf(renamed, "Marketing")).toEqual(["Campaigns", "Field Events"]);
    });

    it("takes out everything when configuration stops naming any of it", () => {
      const seeded = withConfiguredCategories(defaultTaxonomy(), CONFIG);
      const emptied = reconcileConfiguredCategories(seeded, CONFIG, undefined);

      expect(categoriesOf(emptied, "Marketing")).toEqual([]);
    });

    it("leaves categories named by hand out of it entirely", () => {
      const base = defaultTaxonomy();
      const own = addCategory(base, idOf(base, "Engineering"), "Example Platform").taxonomy;

      const reconciled = reconcileConfiguredCategories(own, CONFIG, undefined);

      expect(categoriesOf(reconciled, "Engineering")).toEqual(["Example Platform"]);
    });
  });

  describe("the words the subjects themselves use", () => {
    it("widens the vocabulary with a category no configuration named", () => {
      const base = defaultTaxonomy();

      const widened = withSubjectNames(base, [subject("Marketing", "Example Events")]);

      expect(categoriesOf(widened, "Marketing")).toEqual(["Example Events"]);
    });

    it("creates a function nothing has heard of, so its subjects are drawn", () => {
      const widened = withSubjectNames(defaultTaxonomy(), [
        subject("Developer Relations", "Example Talks"),
      ]);

      expect(widened.functions.map((fn) => fn.name).at(-1)).toBe(
        "Developer Relations",
      );
      expect(categoriesOf(widened, "Developer Relations")).toEqual(["Example Talks"]);
    });

    it("adds a name once, however the subjects spelled it", () => {
      const widened = withSubjectNames(defaultTaxonomy(), [
        subject("Marketing", "Example Events"),
        subject("marketing", "example events"),
        subject("MARKETING"),
      ]);

      expect(categoriesOf(widened, "Marketing")).toEqual(["Example Events"]);
      expect(widened.functions).toHaveLength(BUILT_IN_FUNCTIONS.length);
    });

    it("keeps a configured category the subjects have not reached yet", () => {
      const configured = withConfiguredCategories(
        defaultTaxonomy(),
        "Marketing: Example Campaigns",
      );

      const widened = withSubjectNames(configured, [
        subject("Marketing", "Example Events"),
      ]);

      expect(categoriesOf(widened, "Marketing")).toEqual([
        "Example Campaigns",
        "Example Events",
      ]);
    });

    it("gets back a category configuration retired but a subject still names", () => {
      const seeded = withConfiguredCategories(
        defaultTaxonomy(),
        "Marketing: Example Campaigns",
      );
      const retired = reconcileConfiguredCategories(
        seeded,
        "Marketing: Example Campaigns",
        undefined,
      );

      expect(categoriesOf(retired, "Marketing")).toEqual([]);
      expect(
        categoriesOf(
          withSubjectNames(retired, [subject("Marketing", "Example Campaigns")]),
          "Marketing",
        ),
      ).toEqual(["Example Campaigns"]);
    });

    it("takes no notice of a space on the hierarchy axis", () => {
      const base = defaultTaxonomy();

      const widened = withSubjectNames(base, [
        { labels: { initiatives: ["example-goal"], areas: ["example-area"] } },
        { labels: {} },
      ]);

      expect(widened).toBe(base);
    });
  });

  describe("addressing a category", () => {
    /** A marketing function divided once, as a view would divide it. */
    function divided() {
      const base = defaultTaxonomy();
      return addCategory(base, idOf(base, "Marketing"), "Field Events").taxonomy;
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

    it("addresses a category the subjects named exactly as a configured one", () => {
      const base = defaultTaxonomy();
      const configured = addCategory(base, idOf(base, "Marketing"), "Field Events");
      const widened = withSubjectNames(defaultTaxonomy(), [
        subject("Marketing", "Field Events"),
      ]);
      const { fn, category } = only(widened);

      // The same address either way, so a link written from one view opens
      // in a browser that only learned the name from the records.
      expect(categorySlug(fn, category)).toBe(
        categorySlug(
          { id: idOf(configured.taxonomy, "Marketing") },
          { id: configured.id },
        ),
      );
    });
  });
});
