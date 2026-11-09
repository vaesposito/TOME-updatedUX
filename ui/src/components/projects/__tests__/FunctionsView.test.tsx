/** @jest-environment jsdom */

import { render, screen, within } from "@testing-library/react";

import { FunctionsView } from "@/components/projects/FunctionsView";
import { ORG_FUNCTIONS } from "@/components/projects/navigation";

describe("FunctionsView", () => {
  it("draws the organisation, including the parts holding nothing", () => {
    render(<FunctionsView spaces={[]} />);

    for (const name of ORG_FUNCTIONS) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getAllByText("Nothing here yet.")).toHaveLength(
      ORG_FUNCTIONS.length,
    );
  });

  it("names the spaces a function keeps, rather than restating the catalogue", () => {
    render(
      <FunctionsView
        spaces={[
          { slug: "example-project", title: "Example Project", functions: ["Engineering"] },
          { slug: "other-space", title: "Other Space", functions: ["engineering"] },
        ]}
      />,
    );

    const card = screen.getByRole("heading", { name: "Engineering" }).closest("li")!;
    expect(within(card).getByRole("link", { name: /Example Project/ })).toHaveAttribute(
      "href",
      "/projects/example-project/tome",
    );
    // Matched however the tag was spelled, so one function is one card.
    expect(within(card).getByRole("link", { name: /Other Space/ })).toBeInTheDocument();
    expect(within(card).getByText("2")).toBeInTheDocument();
  });

  it("counts what has no function as something to fix, not as a function", () => {
    render(
      <FunctionsView
        spaces={[{ slug: "example-project", title: "Example Project", functions: [] }]}
      />,
    );

    expect(screen.getByText(/1 space not assigned to one yet/)).toBeInTheDocument();
    // One card per function and no more: an unassigned space is not a part
    // of the organisation.
    expect(screen.getAllByRole("listitem").filter((row) => row.className.includes("rounded-xl")))
      .toHaveLength(ORG_FUNCTIONS.length);
  });

  it("says how many functions there are, not how many projects", () => {
    render(
      <FunctionsView
        spaces={[{ slug: "example-project", title: "Example Project", functions: [] }]}
      />,
    );

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("5 functions");
  });
});
