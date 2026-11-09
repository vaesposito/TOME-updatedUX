/** @jest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";

import { FunctionsView } from "@/components/projects/FunctionsView";
import type { EnrichedProject } from "@/components/projects/ProjectCard";
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

/** A marketing function divided into one category holding two projects. */
function marketingWithEvents() {
  store((base) => {
    const marketing = base.functions.find((fn) => fn.name === "Marketing")!;
    return addCategory(base, marketing.id, "Field Events", [
      "first-example-project",
      "second-example-project",
    ]).taxonomy;
  });
}

function project(
  slug: string,
  title: string,
  functions: string[] = [],
): EnrichedProject {
  return {
    _id: slug,
    slug,
    name: slug,
    title,
    description: `About ${title}.`,
    labels: { functions },
  } as unknown as EnrichedProject;
}

const PROJECTS = [
  project("first-example-project", "First Example Project"),
  project("second-example-project", "Second Example Project"),
];

/** The group a name heads, found by the control that opens and closes it. */
function groupOf(name: string): HTMLElement {
  const caret = screen.getByRole("button", { name: `Collapse ${name}` });
  return caret.parentElement!.parentElement!;
}

describe("FunctionsView", () => {
  beforeEach(() => window.localStorage.clear());

  it("draws every function as a group that opens and closes, as the catalogue does", () => {
    render(<FunctionsView projects={[]} />);

    for (const name of BUILT_IN_FUNCTIONS) {
      expect(
        screen.getByRole("button", { name: `Collapse ${name}` }),
      ).toHaveAttribute("aria-expanded", "true");
    }
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "5 functions",
    );
  });

  it("nests a category under its function and the projects under the category", () => {
    marketingWithEvents();
    render(<FunctionsView projects={PROJECTS} />);

    const marketing = groupOf("Marketing");
    const category = within(marketing).getByRole("button", {
      name: "Collapse Field Events",
    });
    expect(category).toBeInTheDocument();

    // The same card the catalogue draws, leading to the project itself.
    expect(
      within(marketing).getByRole("link", { name: /First Example Project/ }),
    ).toHaveAttribute("href", "/projects/first-example-project");
  });

  it("closes a function, and closes one category without the rest", () => {
    marketingWithEvents();
    render(<FunctionsView projects={PROJECTS} />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse Field Events" }));
    expect(
      screen.queryByRole("link", { name: /First Example Project/ }),
    ).not.toBeInTheDocument();
    // The function above it stays open.
    expect(
      screen.getByRole("button", { name: "Collapse Marketing" }),
    ).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "Collapse Marketing" }));
    expect(
      screen.queryByRole("button", { name: /Expand Field Events/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand Marketing" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps a project that names a function on itself, outside any category", () => {
    marketingWithEvents();
    render(
      <FunctionsView
        projects={[
          ...PROJECTS,
          // Spelled differently on purpose: one function is one group.
          project("third-example-project", "Third Example Project", ["marketing"]),
        ]}
      />,
    );

    const marketing = groupOf("Marketing");
    expect(
      within(marketing).getByText("Tagged directly (no category)"),
    ).toBeInTheDocument();
    expect(
      within(marketing).getByRole("link", { name: /Third Example Project/ }),
    ).toBeInTheDocument();
  });

  it("gathers what is in no function into its own group, as Ungrouped is", () => {
    render(<FunctionsView projects={PROJECTS} />);

    const unassigned = groupOf("Unassigned");
    expect(
      within(unassigned).getByRole("link", { name: /First Example Project/ }),
    ).toBeInTheDocument();
    expect(
      within(unassigned).getByRole("link", { name: /Second Example Project/ }),
    ).toBeInTheDocument();
  });

  /** Type into the view's one filter, as the catalogue's own works. */
  function find(text: string) {
    fireEvent.change(
      screen.getByLabelText("Find a function, category or project"),
      { target: { value: text } },
    );
  }

  it("narrows to the function a query names, keeping all of it", () => {
    marketingWithEvents();
    render(<FunctionsView projects={PROJECTS} />);

    expect(screen.getByRole("button", { name: "Collapse Engineering" }))
      .toBeInTheDocument();

    find("marketing");

    expect(screen.queryByRole("button", { name: "Collapse Engineering" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse Field Events" }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Second Example Project/ }))
      .toBeInTheDocument();
  });

  it("reaches a category through its own name", () => {
    marketingWithEvents();
    render(<FunctionsView projects={PROJECTS} />);

    find("field");

    expect(screen.getByRole("button", { name: "Collapse Marketing" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse SLT" }))
      .not.toBeInTheDocument();
    // Named outright, so everything under it stays.
    expect(screen.getByRole("link", { name: /First Example Project/ }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Second Example Project/ }))
      .toBeInTheDocument();
  });

  it("reaches a project, and keeps only what was reached", () => {
    marketingWithEvents();
    render(<FunctionsView projects={PROJECTS} />);

    find("second");

    expect(screen.getByRole("button", { name: "Collapse Field Events" }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Second Example Project/ }))
      .toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /First Example Project/ }))
      .not.toBeInTheDocument();
  });

  it("narrows on a second word rather than widening, as the catalogue does", () => {
    marketingWithEvents();
    render(<FunctionsView projects={PROJECTS} />);

    // The function's own name counts towards what is under it, so naming
    // both the function and the category reaches the category.
    find("marketing events");

    expect(screen.getByRole("button", { name: "Collapse Field Events" }))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "1 of 5 functions",
    );

    find("marketing nowhere");
    expect(
      screen.getByText(/No function, category or project matches/),
    ).toBeInTheDocument();
  });

  it("reaches a project by its slug too", () => {
    marketingWithEvents();
    render(<FunctionsView projects={PROJECTS} />);

    find("second-example-project");

    expect(screen.getByRole("link", { name: /Second Example Project/ }))
      .toBeInTheDocument();
  });

  it("counts what the query left, as the catalogue does", () => {
    marketingWithEvents();
    render(<FunctionsView projects={PROJECTS} />);

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "5 functions",
    );
    find("marketing");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "1 of 5 functions",
    );
  });

  it("clears the query from the field's own control", () => {
    marketingWithEvents();
    render(<FunctionsView projects={PROJECTS} />);
    find("marketing");

    fireEvent.click(screen.getByRole("button", { name: "Clear function search" }));

    expect(screen.getByRole("button", { name: "Collapse Engineering" }))
      .toBeInTheDocument();
  });

  it("opens the creation flow on the function whose row was used", () => {
    render(<FunctionsView projects={PROJECTS} />);

    fireEvent.click(
      within(groupOf("Marketing")).getByRole("button", { name: "Add category" }),
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Marketing" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps a category made in the flow, and puts the tagged project under it", () => {
    render(<FunctionsView projects={PROJECTS} />);

    fireEvent.click(
      within(groupOf("Marketing")).getByRole("button", { name: "Add category" }),
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Field Events" },
    });
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /First Example Project/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /Create category/ }));

    const marketing = groupOf("Marketing");
    expect(
      within(marketing).getByRole("button", { name: "Collapse Field Events" }),
    ).toBeInTheDocument();
    expect(
      within(marketing).getByRole("link", { name: /First Example Project/ }),
    ).toBeInTheDocument();
    // Stored, so it is still there on the next visit.
    expect(window.localStorage.getItem("tome.function-taxonomy.v1")).toContain(
      "Field Events",
    );
  });
});
