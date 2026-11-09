/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FunctionCategoryView } from "@/components/projects/FunctionCategoryView";
import {
  addCategory,
  categorySlug,
  defaultTaxonomy,
} from "@/lib/projects/function-taxonomy";

/** A marketing function divided into one category holding two projects. */
function marketingWithEvents() {
  const base = defaultTaxonomy();
  const marketing = base.functions.find((fn) => fn.name === "Marketing")!;
  const { taxonomy, id } = addCategory(base, marketing.id, "Field Events", [
    "first-example-project",
    "second-example-project",
  ]);
  window.localStorage.setItem(
    "tome.function-taxonomy.v1",
    JSON.stringify(taxonomy),
  );
  return categorySlug({ id: marketing.id }, { id });
}

function project(slug: string, title: string) {
  return {
    _id: slug,
    slug,
    name: slug,
    title,
    description: `About ${title}.`,
  };
}

const PROJECTS = [
  project("first-example-project", "First Example Project"),
  project("second-example-project", "Second Example Project"),
  project("third-example-project", "Third Example Project"),
];

describe("FunctionCategoryView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // The payload the catalogue is read from, which nests the list.
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: { projects: PROJECTS } }),
      } as Response),
    );
  });

  it("reads a category as the catalogue reads its projects", async () => {
    const slug = marketingWithEvents();
    render(<FunctionCategoryView slug={slug} />);

    expect(
      await screen.findByRole("heading", { level: 1, name: /Field Events/ }),
    ).toBeInTheDocument();
    // The function it divides, said once, and the way back to it.
    expect(screen.getByText("How Marketing divides its work.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /By function/ })).toHaveAttribute(
      "href",
      "/projects?tab=functions",
    );

    // The hub's own count and toolbar, and a full card per project rather
    // than the condensed list the category card has room for.
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
        "2 projects",
      ),
    );
    expect(
      screen.getByRole("link", { name: /First Example Project/ }),
    ).toHaveAttribute("href", "/projects/first-example-project");
    expect(
      screen.getByRole("link", { name: /Second Example Project/ }),
    ).toHaveAttribute("href", "/projects/second-example-project");
    // What the category never held stays out of it.
    expect(
      screen.queryByRole("link", { name: /Third Example Project/ }),
    ).not.toBeInTheDocument();
  });

  it("narrows to what the search leaves, as the catalogue does", async () => {
    const slug = marketingWithEvents();
    render(<FunctionCategoryView slug={slug} />);
    await screen.findByRole("link", { name: /First Example Project/ });

    fireEvent.change(screen.getByLabelText("Find a project in this category"), {
      target: { value: "second" },
    });

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "1 of 2 projects",
    );
    expect(
      screen.queryByRole("link", { name: /First Example Project/ }),
    ).not.toBeInTheDocument();
  });

  it("says so plainly when this browser has no such category", async () => {
    render(<FunctionCategoryView slug="marketing--nothing-here" />);

    expect(
      await screen.findByText(/No such category on this device/),
    ).toBeInTheDocument();
    // A way out rather than an empty screen: the empty state's own, beside
    // the one in the header.
    const out = screen.getAllByRole("link", { name: "By function" });
    expect(out).toHaveLength(2);
    for (const link of out) {
      expect(link).toHaveAttribute("href", "/projects?tab=functions");
    }
  });

  it("offers the way to fill a category nothing is tagged into", async () => {
    const base = defaultTaxonomy();
    const marketing = base.functions.find((fn) => fn.name === "Marketing")!;
    const { taxonomy, id } = addCategory(base, marketing.id, "Field Events");
    window.localStorage.setItem(
      "tome.function-taxonomy.v1",
      JSON.stringify(taxonomy),
    );

    render(
      <FunctionCategoryView
        slug={categorySlug({ id: marketing.id }, { id })}
      />,
    );

    expect(
      await screen.findByText(/Nothing tagged into this category yet/),
    ).toBeInTheDocument();
  });
});
