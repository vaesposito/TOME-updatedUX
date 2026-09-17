import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { IssueLabelDisclosure } from "../IssueLabelDisclosure";

function DisclosureHarness({ slug = "example-project" }: { slug?: string }) {
  return (
    <IssueLabelDisclosure
      slug={slug}
      controlsId="issue-label-views"
      header={<span>Issues</span>}
      actions={<button type="button">Add</button>}
    >
      <span>Decisions</span>
    </IssueLabelDisclosure>
  );
}

describe("IssueLabelDisclosure", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts expanded and remembers a project's collapsed state", async () => {
    const { unmount } = render(<DisclosureHarness />);

    const collapse = screen.getByRole("button", {
      name: "Collapse issue label views",
    });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Decisions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();

    fireEvent.click(collapse);
    expect(screen.queryByText("Decisions")).not.toBeInTheDocument();
    expect(screen.getByText("Issues")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(
      window.localStorage.getItem("tome.issue-label-views.expanded.example-project"),
    ).toBe("false");

    unmount();
    render(<DisclosureHarness />);

    await waitFor(() => {
      expect(screen.getByRole("button", {
        name: "Expand issue label views",
      })).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText("Decisions")).not.toBeInTheDocument();
    });
  });

  it("stores the selection separately for each project", async () => {
    window.localStorage.setItem(
      "tome.issue-label-views.expanded.first-project",
      "false",
    );

    render(<DisclosureHarness slug="second-project" />);

    await waitFor(() => {
      expect(screen.getByRole("button", {
        name: "Collapse issue label views",
      })).toBeInTheDocument();
      expect(screen.getByText("Decisions")).toBeInTheDocument();
    });
  });

  it("keeps fixed issue views expanded when collapsing is disabled", () => {
    render(
      <IssueLabelDisclosure
        slug="example-project"
        collapsible={false}
        controlsId="fixed-issue-views"
        header={<span>Issues</span>}
        actions={null}
      >
        <span>Tome Tracker</span>
      </IssueLabelDisclosure>,
    );

    expect(screen.getByText("Tome Tracker")).toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: "Collapse issue label views",
    })).not.toBeInTheDocument();
  });
});
