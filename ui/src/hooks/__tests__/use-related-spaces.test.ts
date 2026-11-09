/** @jest-environment jsdom */

import { renderHook, waitFor } from "@testing-library/react";

import { useRelatedSpaces } from "@/hooks/use-related-spaces";
import { addCategory, defaultTaxonomy } from "@/lib/projects/function-taxonomy";

/** Tag three spaces into one marketing category and store the result. */
function storeTagged(spaces: string[]) {
  const base = defaultTaxonomy();
  const marketing = base.functions.find((fn) => fn.name === "Marketing")!;
  window.localStorage.setItem(
    "tome.function-taxonomy.v1",
    JSON.stringify(addCategory(base, marketing.id, "Field Events", spaces).taxonomy),
  );
}

/** The catalogue, as /api/projects answers it. */
function catalogue(rows: { slug: string; title: string }[]) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { projects: rows } }),
  }) as unknown as typeof fetch;
}

describe("useRelatedSpaces", () => {
  beforeEach(() => {
    window.localStorage.clear();
    catalogue([
      { slug: "first-example-project", title: "First Example Project" },
      { slug: "second-example-project", title: "Second Example Project" },
    ]);
  });

  it("names the spaces sharing a category, and the category they share", async () => {
    storeTagged(["first-example-project", "second-example-project"]);

    const { result } = renderHook(() => useRelatedSpaces("first-example-project"));

    // Waiting on the name rather than on the row: the device's copy of the
    // taxonomy is read before the catalogue answers, so the row exists
    // under its slug first and is named a moment later.
    await waitFor(() =>
      expect(result.current.related[0]?.title).toBe("Second Example Project"),
    );
    expect(result.current.related).toEqual([
      {
        slug: "second-example-project",
        title: "Second Example Project",
        through: ["Field Events"],
      },
    ]);
  });

  it("finds nothing for a space tagged into nothing", async () => {
    storeTagged(["first-example-project"]);

    const { result } = renderHook(() => useRelatedSpaces("other-space"));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.related).toEqual([]);
  });

  it("still lists a space the catalogue could not name", async () => {
    storeTagged(["first-example-project", "unlisted-space"]);
    const { result } = renderHook(() => useRelatedSpaces("first-example-project"));

    await waitFor(() => expect(result.current.related).toHaveLength(1));
    // Under its slug rather than dropped: it belongs to the group whether or
    // not this reader can see its name.
    expect(result.current.related[0].title).toBe("unlisted-space");
  });

  it("keeps the group when the catalogue cannot be read", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    storeTagged(["first-example-project", "second-example-project"]);

    const { result } = renderHook(() => useRelatedSpaces("first-example-project"));

    await waitFor(() => expect(result.current.related).toHaveLength(1));
    expect(result.current.related[0].title).toBe("second-example-project");
  });
});
