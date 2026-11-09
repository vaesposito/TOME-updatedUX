/** @jest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";

import { FunctionsView } from "@/components/projects/FunctionsView";
import {
  BUILT_IN_FUNCTIONS,
  addCategory,
  defaultTaxonomy,
} from "@/lib/projects/function-taxonomy";

/** Put a taxonomy on the device the way the hook will later read it. */
function store(build: (base: ReturnType<typeof defaultTaxonomy>) => unknown) {
  window.localStorage.setItem(
    "tome.function-taxonomy.v1",
    JSON.stringify(build(defaultTaxonomy())),
  );
}

/** A marketing function divided into one category holding two spaces. */
function marketingWithEvents() {
  store((base) => {
    const marketing = base.functions.find((fn) => fn.name === "Marketing")!;
    return addCategory(base, marketing.id, "Field Events", [
      "first-example-project",
      "second-example-project",
    ]).taxonomy;
  });
}

const SPACES = [
  { slug: "first-example-project", title: "First Example Project", functions: [] },
  { slug: "second-example-project", title: "Second Example Project", functions: [] },
];

describe("FunctionsView", () => {
  beforeEach(() => window.localStorage.clear());

  it("draws the organisation, including the parts holding nothing", () => {
    render(<FunctionsView spaces={[]} />);

    for (const name of BUILT_IN_FUNCTIONS) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "5 functions",
    );
  });

  it("names the spaces a category keeps, rather than restating the catalogue", () => {
    marketingWithEvents();
    render(<FunctionsView spaces={SPACES} />);

    const card = screen
      .getByRole("heading", { level: 3, name: "Marketing" })
      .closest("li")!;
    expect(
      within(card).getByRole("heading", { level: 4, name: "Field Events" }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: /First Example Project/ }),
    ).toHaveAttribute("href", "/projects/first-example-project/tome");
  });

  it("still keeps a space that names a function on itself, outside any category", () => {
    render(
      <FunctionsView
        spaces={[
          // Spelled differently on purpose: one function is one card.
          { slug: "example-project", title: "Example Project", functions: ["engineering"] },
        ]}
      />,
    );

    const card = screen
      .getByRole("heading", { level: 3, name: "Engineering" })
      .closest("li")!;
    expect(within(card).getByText("Not in a category")).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: /Example Project/ }),
    ).toBeInTheDocument();
  });

  it("counts what is in no function as something to fix, not as a function", () => {
    render(
      <FunctionsView
        spaces={[{ slug: "example-project", title: "Example Project", functions: [] }]}
      />,
    );

    expect(screen.getByText(/1 space not assigned to one yet/)).toBeInTheDocument();
  });

  it("narrows to one function, and then to one of its categories", () => {
    marketingWithEvents();
    render(<FunctionsView spaces={SPACES} />);

    // Every function is drawn until one is asked for.
    expect(screen.getByRole("heading", { level: 3, name: "Engineering" }))
      .toBeInTheDocument();

    const functions = screen.getByRole("group", { name: "Filter by function" });
    fireEvent.click(within(functions).getByRole("button", { name: /Marketing/ }));

    expect(screen.queryByRole("heading", { level: 3, name: "Engineering" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Marketing" }))
      .toBeInTheDocument();

    // The categories of the chosen function only, since two functions can
    // divide their work by the same word and mean different things.
    const categories = screen.getByRole("group", {
      name: "Filter by category in Marketing",
    });
    fireEvent.click(within(categories).getByRole("button", { name: /Field Events/ }));

    expect(screen.getByRole("heading", { level: 4, name: "Field Events" }))
      .toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Second Example Project/ }),
    ).toBeInTheDocument();
  });

  it("offers no category filter until a function is chosen", () => {
    marketingWithEvents();
    render(<FunctionsView spaces={SPACES} />);

    expect(
      screen.queryByRole("group", { name: /Filter by category/ }),
    ).not.toBeInTheDocument();
  });

  it("says what each filter holds, so a reader need not open an empty one", () => {
    marketingWithEvents();
    render(<FunctionsView spaces={SPACES} />);

    const functions = screen.getByRole("group", { name: "Filter by function" });
    expect(
      within(functions).getByRole("button", { name: /Marketing/ }),
    ).toHaveTextContent("Marketing2");
    expect(
      within(functions).getByRole("button", { name: /^SLT/ }),
    ).toHaveTextContent("SLT0");
  });

  it("opens the creation flow on the function whose row was used", () => {
    render(<FunctionsView spaces={SPACES} />);

    const card = screen
      .getByRole("heading", { level: 3, name: "Marketing" })
      .closest("li")!;
    fireEvent.click(within(card).getByRole("button", { name: "Add category" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Marketing" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps a category made in the flow, and puts the tagged space under it", () => {
    render(<FunctionsView spaces={SPACES} />);

    const card = screen
      .getByRole("heading", { level: 3, name: "Marketing" })
      .closest("li")!;
    fireEvent.click(within(card).getByRole("button", { name: "Add category" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Field Events" },
    });
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /First Example Project/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /Create category/ }));

    const after = screen
      .getByRole("heading", { level: 3, name: "Marketing" })
      .closest("li")!;
    expect(
      within(after).getByRole("heading", { level: 4, name: "Field Events" }),
    ).toBeInTheDocument();
    expect(
      within(after).getByRole("link", { name: /First Example Project/ }),
    ).toBeInTheDocument();
    // Stored, so it is still there on the next visit.
    expect(window.localStorage.getItem("tome.function-taxonomy.v1")).toContain(
      "Field Events",
    );
  });
});
