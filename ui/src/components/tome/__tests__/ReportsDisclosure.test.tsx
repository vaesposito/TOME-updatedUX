/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ReportsDisclosure } from "../ReportsDisclosure";

describe("ReportsDisclosure", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts expanded and remembers a project's collapsed state", async () => {
    const { unmount } = render(
      <ReportsDisclosure slug="example-project">
        <span>Stand-up</span>
      </ReportsDisclosure>,
    );

    expect(screen.getByText("Stand-up")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Reports" }));

    expect(screen.queryByText("Stand-up")).not.toBeInTheDocument();
    expect(
      window.localStorage.getItem("tome.reports.expanded.example-project"),
    ).toBe("false");

    unmount();
    render(
      <ReportsDisclosure slug="example-project">
        <span>Stand-up</span>
      </ReportsDisclosure>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Expand Reports" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Stand-up")).not.toBeInTheDocument();
    });
  });

  it("stores the selection separately for each project", async () => {
    window.localStorage.setItem("tome.reports.expanded.first-project", "false");

    render(
      <ReportsDisclosure slug="second-project">
        <span>Issues</span>
      </ReportsDisclosure>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Collapse Reports" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Issues")).toBeInTheDocument();
    });
  });
});
