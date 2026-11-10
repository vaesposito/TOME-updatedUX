/** @jest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";

import { FunctionsView } from "@/components/projects/FunctionsView";
import type { EnrichedProject } from "@/components/projects/ProjectCard";
import {
  BUILT_IN_FUNCTIONS,
  addCategory,
  defaultTaxonomy,
} from "@/lib/projects/function-taxonomy";

/** Put a vocabulary on the device the way the hook will later read it. */
function store(build: (base: ReturnType<typeof defaultTaxonomy>) => unknown) {
  window.localStorage.setItem(
    "tome.function-taxonomy.v1",
    JSON.stringify(build(defaultTaxonomy())),
  );
}

/** Marketing, divided once. Names only — no record of what is inside. */
function marketingWithEvents() {
  store((base) => {
    const marketing = base.functions.find((fn) => fn.name === "Marketing")!;
    return addCategory(base, marketing.id, "Field Events").taxonomy;
  });
}

/** A space, placed by what it says about itself. */
function space(
  slug: string,
  title: string,
  labels: Record<string, string[]> = {},
): EnrichedProject {
  return {
    _id: slug,
    slug,
    name: slug,
    title,
    description: `About ${title}.`,
    labels,
  } as unknown as EnrichedProject;
}

const SUBJECTS = [
  space("first-example-subject", "First Example Subject", {
    functions: ["Marketing"],
    categories: ["Field Events"],
  }),
  space("second-example-subject", "Second Example Subject", {
    functions: ["Marketing"],
    categories: ["Field Events"],
  }),
];

/** The group a name heads, found by the control that opens and closes it. */
function groupOf(name: string): HTMLElement {
  const caret = screen.getByRole("button", { name: `Collapse ${name}` });
  return caret.parentElement!.parentElement!;
}

/** Type into the view's one filter. */
function find(text: string) {
  fireEvent.change(screen.getByLabelText("Find a TOME subject"), {
    target: { value: text },
  });
}

describe("FunctionsView", () => {
  beforeEach(() => window.localStorage.clear());

  it("draws every function as a group that opens and closes, as the catalogue does", () => {
    render(<FunctionsView subjects={[]} />);

    for (const name of BUILT_IN_FUNCTIONS) {
      expect(
        screen.getByRole("button", { name: `Collapse ${name}` }),
      ).toHaveAttribute("aria-expanded", "true");
    }
  });

  it("counts what the tab is a list of: its subjects, not its functions", () => {
    marketingWithEvents();
    render(<FunctionsView subjects={SUBJECTS} />);

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "2 subjects",
    );
  });

  it("places a subject by what the subject says, not by anything this browser holds", () => {
    // The stored vocabulary names the category and nothing else. Where the
    // two subjects sit is read off their own labels.
    marketingWithEvents();
    render(<FunctionsView subjects={SUBJECTS} />);

    const events = groupOf("Field Events");
    expect(
      within(events).getByRole("link", { name: /First Example Subject/ }),
    ).toHaveAttribute("href", "/projects/first-example-subject");
    expect(
      within(events).getByRole("link", { name: /Second Example Subject/ }),
    ).toBeInTheDocument();
  });

  it("draws a category a subject names that this deployment never configured", () => {
    // Nothing is stored at all: the vocabulary is widened by the subject.
    render(
      <FunctionsView
        subjects={[
          space("third-example-subject", "Third Example Subject", {
            functions: ["Marketing"],
            categories: ["Unconfigured Category"],
          }),
        ]}
      />,
    );

    const category = groupOf("Unconfigured Category");
    expect(
      within(category).getByRole("heading", {
        level: 3,
        name: "Third Example Subject",
      }),
    ).toBeInTheDocument();
    // And it sits under the function it was named with, not loose.
    expect(
      within(groupOf("Marketing")).getByRole("button", {
        name: "Collapse Unconfigured Category",
      }),
    ).toBeInTheDocument();
  });

  it("keeps a subject naming a function and no category at the function's own level", () => {
    marketingWithEvents();
    render(
      <FunctionsView
        subjects={[
          ...SUBJECTS,
          // Spelled differently on purpose: one function is one group.
          space("loose-example-subject", "Loose Example Subject", {
            functions: ["marketing"],
          }),
        ]}
      />,
    );

    const marketing = groupOf("Marketing");
    expect(
      within(marketing).getByText("In this function (no category)"),
    ).toBeInTheDocument();
    expect(
      within(groupOf("Field Events")).queryByRole("heading", {
        level: 3,
        name: "Loose Example Subject",
      }),
    ).not.toBeInTheDocument();
  });

  it("draws nothing for a space on the other axis, which belongs to the catalogue", () => {
    // The hub hands the two tabs disjoint lists; nothing here is a fallback
    // for a record that names no function.
    render(
      <FunctionsView
        subjects={[]}
        // A hierarchy space would never arrive here, and there is no group
        // waiting to catch one if it did.
      />,
    );

    expect(screen.queryByText(/Unassigned/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ungrouped/)).not.toBeInTheDocument();
  });

  it("leads from a category's name to its own page, as an area's leads to its wiki", () => {
    marketingWithEvents();
    render(<FunctionsView subjects={SUBJECTS} />);

    expect(
      within(groupOf("Field Events")).getByRole("link", { name: "Field Events" }),
    ).toHaveAttribute(
      "href",
      "/projects/functions/marketing--marketing-field-events",
    );
  });

  it("offers creation once, in the toolbar, as the catalogue does", () => {
    marketingWithEvents();
    render(<FunctionsView subjects={SUBJECTS} />);

    expect(screen.getAllByRole("button", { name: /Add subject/ })).toHaveLength(1);
    // And a group row carries what a BHAG or Area row carries: nothing else.
    expect(
      within(groupOf("Field Events")).queryByRole("button", { name: /Rename/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add category/ }),
    ).not.toBeInTheDocument();
  });

  it("opens the creation flow on the function axis", () => {
    marketingWithEvents();
    render(<FunctionsView subjects={SUBJECTS} />);

    fireEvent.click(screen.getByRole("button", { name: /Add subject/ }));

    // A subject and nothing else: the function axis has one kind of leaf.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Subject/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Function")).toBeInTheDocument();
  });

  it("narrows to the subjects a query leaves, counting what is left", () => {
    marketingWithEvents();
    render(<FunctionsView subjects={SUBJECTS} />);

    find("second");

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "1 of 2 subjects",
    );
    expect(
      screen.getByRole("link", { name: /Second Example Subject/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /First Example Subject/ }),
    ).not.toBeInTheDocument();
    // The function and the category survive because they hold the match.
    expect(screen.getByRole("button", { name: "Collapse Marketing" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse SLT" }))
      .not.toBeInTheDocument();
  });

  it("keeps everything under a function or a category the query names", () => {
    marketingWithEvents();
    render(<FunctionsView subjects={SUBJECTS} />);

    find("field events");

    expect(screen.getByRole("link", { name: /First Example Subject/ }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Second Example Subject/ }))
      .toBeInTheDocument();
  });

  it("says so when nothing is left, and clears from the field's own control", () => {
    marketingWithEvents();
    render(<FunctionsView subjects={SUBJECTS} />);

    find("nothing matches this");
    expect(screen.getByText(/No subject matches/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear subject search" }));
    expect(screen.getByRole("button", { name: "Collapse Engineering" }))
      .toBeInTheDocument();
  });

  it("closes a function, taking its categories with it", () => {
    marketingWithEvents();
    render(<FunctionsView subjects={SUBJECTS} />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse Marketing" }));

    expect(
      screen.queryByRole("button", { name: /Collapse Field Events/ }),
    ).not.toBeInTheDocument();
  });

  it("says a category holds nothing yet rather than drawing an empty grid", () => {
    marketingWithEvents();
    render(<FunctionsView subjects={[]} />);

    expect(
      within(groupOf("Field Events")).getByText(
        "No subjects in this category yet.",
      ),
    ).toBeInTheDocument();
  });
});
