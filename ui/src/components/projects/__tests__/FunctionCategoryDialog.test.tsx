/** @jest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";

import {
  FunctionCategoryDialog,
  type CategoryDraft,
} from "@/components/projects/FunctionCategoryDialog";
import {
  addCategory,
  defaultTaxonomy,
  placementsOf,
  type FunctionTaxonomy,
} from "@/lib/projects/function-taxonomy";

const SPACES = [
  { slug: "first-example-project", title: "First Example Project" },
  { slug: "second-example-project", title: "Second Example Project" },
];

function marketingId(taxonomy: FunctionTaxonomy): string {
  return taxonomy.functions.find((fn) => fn.name === "Marketing")!.id;
}

/**
 * The dialog with the taxonomy held outside it, as the view holds it: what
 * the form commits has to be visible to whatever renders next.
 */
function Harness({
  initial = defaultTaxonomy(),
  draft,
  onChange,
}: {
  initial?: FunctionTaxonomy;
  draft?: Partial<CategoryDraft>;
  onChange?: (next: FunctionTaxonomy) => void;
}) {
  const [taxonomy, setTaxonomy] = React.useState(initial);
  return (
    <FunctionCategoryDialog
      open
      onOpenChange={() => {}}
      taxonomy={taxonomy}
      spaces={SPACES}
      draft={{
        functionId: marketingId(taxonomy),
        name: "",
        spaces: [],
        ...draft,
      }}
      onCommit={(next) =>
        setTaxonomy((current) => {
          const updated = next(current);
          onChange?.(updated);
          return updated;
        })
      }
    />
  );
}

describe("FunctionCategoryDialog", () => {
  it("makes a category under the chosen function, holding the spaces ticked", () => {
    let latest: FunctionTaxonomy | null = null;
    render(<Harness onChange={(next) => (latest = next)} />);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Field Events" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Second Example Project/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Create category/ }));

    expect(placementsOf(latest!, "second-example-project")).toEqual([
      expect.objectContaining({
        functionName: "Marketing",
        categoryName: "Field Events",
      }),
    ]);
    expect(placementsOf(latest!, "first-example-project")).toEqual([]);
  });

  it("will not make a category with no name", () => {
    render(<Harness />);

    expect(screen.getByRole("button", { name: /Create category/ })).toBeDisabled();
  });

  it("says so rather than quietly merging when the name is taken", () => {
    const base = defaultTaxonomy();
    const { taxonomy } = addCategory(base, marketingId(base), "Field Events");
    render(<Harness initial={taxonomy} />);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "field events" },
    });

    expect(
      screen.getByText("That function already has a category by this name."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create category/ })).toBeDisabled();
  });

  it("makes a function from the same form, and puts the category in it", () => {
    let latest: FunctionTaxonomy | null = null;
    render(<Harness onChange={(next) => (latest = next)} />);

    fireEvent.click(screen.getByRole("button", { name: /New function/ }));
    fireEvent.change(screen.getByLabelText("Name of the new function"), {
      target: { value: "Developer Relations" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // Chosen, not merely added: the reader named it in order to use it.
    expect(
      screen.getByRole("button", { name: "Developer Relations" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Talks" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /First Example/ }));
    fireEvent.click(screen.getByRole("button", { name: /Create category/ }));

    expect(placementsOf(latest!, "first-example-project")).toEqual([
      expect.objectContaining({
        functionName: "Developer Relations",
        categoryName: "Talks",
      }),
    ]);
  });

  it("opens on what an existing category already holds, and saves the change", () => {
    const base = defaultTaxonomy();
    const { taxonomy, id } = addCategory(base, marketingId(base), "Field Events", [
      "first-example-project",
    ]);
    let latest: FunctionTaxonomy | null = null;
    render(
      <Harness
        initial={taxonomy}
        draft={{ categoryId: id, name: "Field Events", spaces: ["first-example-project"] }}
        onChange={(next) => (latest = next)}
      />,
    );

    expect(screen.getByLabelText("Name")).toHaveValue("Field Events");
    expect(
      screen.getByRole("checkbox", { name: /First Example Project/ }),
    ).toHaveAttribute("aria-checked", "true");

    fireEvent.click(
      screen.getByRole("checkbox", { name: /Second Example Project/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Save category/ }));

    expect(placementsOf(latest!, "second-example-project")).toHaveLength(1);
    expect(placementsOf(latest!, "first-example-project")).toHaveLength(1);
  });

  it("untags a space the second time it is clicked", () => {
    let latest: FunctionTaxonomy | null = null;
    render(<Harness onChange={(next) => (latest = next)} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Talks" } });
    const row = screen.getByRole("checkbox", { name: /First Example Project/ });
    fireEvent.click(row);
    fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: /Create category/ }));

    expect(placementsOf(latest!, "first-example-project")).toEqual([]);
  });

  it("counts what has been tagged while the form is open", () => {
    render(<Harness />);

    expect(screen.getByText("0 tagged")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /First Example/ }));
    expect(screen.getByText("1 tagged")).toBeInTheDocument();
  });

  it("offers every function to put the category under", () => {
    render(<Harness />);

    const dialog = screen.getByRole("dialog");
    for (const name of ["SLT", "Engineering", "Marketing"]) {
      expect(within(dialog).getByRole("button", { name })).toBeInTheDocument();
    }
  });
});
