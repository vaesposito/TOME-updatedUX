import { act, renderHook } from "@testing-library/react";

import {
  applyConfiguredCategories,
  useFunctionTaxonomy,
} from "@/hooks/use-function-taxonomy";
import { addCategory } from "@/lib/projects/function-taxonomy";

const STORAGE_KEY = "tome.function-taxonomy.v1";
const SEEDED_KEY = "tome.function-taxonomy.seeded.v1";
const CONFIG = "Marketing: Example Campaigns, Example Field Events";

/** The browser arriving at TOME with this deployment's configuration. */
function arrive(configured: string | undefined) {
  applyConfiguredCategories(configured);
  return renderHook(() => useFunctionTaxonomy());
}

function marketingIn(taxonomy: { functions: { name: string }[] }) {
  return taxonomy.functions.find((fn) => fn.name === "Marketing") as {
    id: string;
    name: string;
    categories: { id: string; name: string; spaces: string[] }[];
  };
}

describe("useFunctionTaxonomy", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts a new browser with the configured categories", () => {
    const { result } = arrive(CONFIG);

    expect(
      marketingIn(result.current.taxonomy).categories.map((c) => c.name),
    ).toEqual(["Example Campaigns", "Example Field Events"]);
  });

  it("starts it with nothing inside when nothing is configured", () => {
    const { result } = arrive(undefined);

    expect(marketingIn(result.current.taxonomy).categories).toEqual([]);
  });

  it("leaves a configured category deleted once it has been deleted", () => {
    const { result } = arrive(CONFIG);
    const gone = marketingIn(result.current.taxonomy).categories[0].id;

    act(() => {
      result.current.update((current) => ({
        functions: current.functions.map((fn) => ({
          ...fn,
          categories: fn.categories.filter((c) => c.id !== gone),
        })),
      }));
    });

    // A second visit under the same configuration: it does not come back.
    const second = arrive(CONFIG);
    expect(
      marketingIn(second.result.current.taxonomy).categories.map((c) => c.name),
    ).toEqual(["Example Field Events"]);
  });

  it("reaches a browser already in use when a category is configured later", () => {
    const { result } = arrive(CONFIG);
    const first = marketingIn(result.current.taxonomy);

    // Something tagged by hand into a configured category, to be kept.
    act(() => {
      result.current.update((current) =>
        addCategory(current, first.id, first.categories[0].name, [
          "example-project",
        ]).taxonomy,
      );
    });

    const later = arrive(`${CONFIG}, Example Webinars`);
    const categories = marketingIn(later.result.current.taxonomy).categories;

    expect(categories.map((c) => c.name)).toEqual([
      "Example Campaigns",
      "Example Field Events",
      "Example Webinars",
    ]);
    expect(categories[0].spaces).toEqual(["example-project"]);
  });

  it("remembers which configuration this browser has been given", () => {
    arrive(CONFIG);

    expect(window.localStorage.getItem(SEEDED_KEY)).toBe(CONFIG);
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain(
      "Example Campaigns",
    );
  });
});
