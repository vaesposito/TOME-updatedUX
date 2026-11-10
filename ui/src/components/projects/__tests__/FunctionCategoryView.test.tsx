/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FunctionCategoryView } from "@/components/projects/FunctionCategoryView";
import {
  addCategory,
  categorySlug,
  defaultTaxonomy,
} from "@/lib/projects/function-taxonomy";

/** Marketing, divided once, with the division's address. */
function marketingWithEvents() {
  const base = defaultTaxonomy();
  const marketing = base.functions.find((fn) => fn.name === "Marketing")!;
  const { taxonomy, id } = addCategory(base, marketing.id, "Field Events");
  window.localStorage.setItem(
    "tome.function-taxonomy.v1",
    JSON.stringify(taxonomy),
  );
  return categorySlug({ id: marketing.id }, { id });
}

function space(
  slug: string,
  title: string,
  labels: Record<string, string[]> = {},
) {
  return {
    _id: slug,
    slug,
    name: slug,
    title,
    description: `About ${title}.`,
    labels,
  };
}

const IN_CATEGORY = {
  functions: ["Marketing"],
  categories: ["Field Events"],
};

/** What the catalogue holds: two subjects here, one elsewhere, one project. */
const SPACES = [
  space("first-example-subject", "First Example Subject", IN_CATEGORY),
  space("second-example-subject", "Second Example Subject", IN_CATEGORY),
  space("other-example-subject", "Other Example Subject", {
    functions: ["Engineering"],
  }),
  space("example-project", "Example Project", { initiatives: ["Example BHAG"] }),
];

describe("FunctionCategoryView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: { projects: SPACES } }),
      } as Response),
    );
  });

  it("lists the subjects that name this category, and nothing else", async () => {
    render(<FunctionCategoryView slug={marketingWithEvents()} />);

    expect(
      await screen.findByRole("heading", { level: 1, name: /Field Events/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("How Marketing divides its work.")).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
        "2 subjects",
      ),
    );
    expect(
      screen.getByRole("link", { name: /First Example Subject/ }),
    ).toHaveAttribute("href", "/projects/first-example-subject");
    // A subject in another function stays out of it...
    expect(
      screen.queryByRole("link", { name: /Other Example Subject/ }),
    ).not.toBeInTheDocument();
    // ...and so does a space on the other axis entirely.
    expect(
      screen.queryByRole("link", { name: /Example Project/ }),
    ).not.toBeInTheDocument();
  });

  it("holds a category no browser knows, recovered from the subjects using it", async () => {
    // Nothing stored: the only record of this category is on the subjects,
    // which is the one record that travels between browsers.
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            projects: [
              space("configured-elsewhere", "Configured Elsewhere", {
                functions: ["Marketing"],
                categories: ["Unconfigured Category"],
              }),
            ],
          },
        }),
      } as Response),
    );

    render(
      <FunctionCategoryView slug="marketing--marketing-unconfigured-category" />,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /Unconfigured Category/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Configured Elsewhere/ }),
    ).toBeInTheDocument();
  });

  it("narrows to what the search leaves, as the catalogue does", async () => {
    render(<FunctionCategoryView slug={marketingWithEvents()} />);
    await screen.findByRole("link", { name: /First Example Subject/ });

    fireEvent.change(screen.getByLabelText("Find a subject in this category"), {
      target: { value: "second" },
    });

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "1 of 2 subjects",
    );
    expect(
      screen.queryByRole("link", { name: /First Example Subject/ }),
    ).not.toBeInTheDocument();
  });

  it("says so plainly when nothing names this category", async () => {
    render(<FunctionCategoryView slug="marketing--nothing-here" />);

    expect(await screen.findByText(/No such category/)).toBeInTheDocument();
    const out = screen.getAllByRole("link", { name: "By function" });
    for (const link of out) {
      expect(link).toHaveAttribute("href", "/projects?tab=functions");
    }
  });

  it("says a configured category is empty rather than drawing nothing", async () => {
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: { projects: [] } }),
      } as Response),
    );

    render(<FunctionCategoryView slug={marketingWithEvents()} />);

    expect(
      await screen.findByText(/No subjects in this category yet/),
    ).toBeInTheDocument();
  });
});
