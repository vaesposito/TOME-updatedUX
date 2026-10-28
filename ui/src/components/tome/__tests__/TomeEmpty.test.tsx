/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

import { TomeEmpty } from "@/components/tome/TomeEmpty";

describe("TomeEmpty", () => {
  it("says what is missing and what would put it there", () => {
    render(
      <TomeEmpty
        icon={<svg data-testid="subject" />}
        headline="No ingests yet"
        hint="Each run is kept here."
      />,
    );

    expect(screen.getByText("No ingests yet")).toBeInTheDocument();
    expect(screen.getByText("Each run is kept here.")).toBeInTheDocument();
  });

  it("keeps the illustration out of the accessibility tree", () => {
    const { container } = render(
      <TomeEmpty
        icon={<svg data-testid="subject" />}
        headline="No ingests yet"
        hint="Each run is kept here."
      />,
    );

    // The headline already carries the message; the drawing would repeat it.
    expect(container.querySelector("span[aria-hidden='true']")).toContainElement(
      screen.getByTestId("subject"),
    );
  });

  it("offers nothing to do where the caller gave it nothing", () => {
    render(
      <TomeEmpty icon={<svg />} headline="No revisions yet" hint="Saves are kept." />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("runs a handler action", () => {
    const onClick = jest.fn();
    render(
      <TomeEmpty
        icon={<svg />}
        headline="No notes yet"
        hint="Save a prompt here."
        action={{ label: "New note", onClick }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("links in this tab by default", () => {
    render(
      <TomeEmpty
        icon={<svg />}
        headline="No attached repositories"
        hint="Attach one here."
        action={{ label: "Attach a repository", href: "/projects/example-project/tome/ingest" }}
      />,
    );

    const link = screen.getByRole("link", { name: "Attach a repository" });
    expect(link).toHaveAttribute("href", "/projects/example-project/tome/ingest");
    expect(link).not.toHaveAttribute("target");
  });

  it("opens somewhere else in a new tab, without reaching back through it", () => {
    render(
      <TomeEmpty
        icon={<svg />}
        headline="No tracked issues yet"
        hint="Issues appear here."
        action={{
          label: "Open on GitHub",
          href: "https://github.example.com/example-org/example-repo/issues",
          newTab: true,
        }}
      />,
    );

    const link = screen.getByRole("link", { name: /Open on GitHub/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});
