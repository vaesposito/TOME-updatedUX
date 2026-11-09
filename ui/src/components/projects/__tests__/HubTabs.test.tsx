/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

import { HubTabs, parseHubTab } from "@/components/projects/HubTabs";
import { TOME_GROUPS } from "@/components/projects/navigation";

describe("parseHubTab", () => {
  it("reads the four it knows", () => {
    expect(parseHubTab("projects")).toBe("projects");
    expect(parseHubTab("functions")).toBe("functions");
    expect(parseHubTab("overview")).toBe("overview");
    expect(parseHubTab("digest")).toBe("digest");
  });

  it("falls back to the catalogue for anything else", () => {
    // A hand-edited or stale address must land somewhere real rather than on
    // a blank page, and the catalogue is what TOME opened on before the tabs.
    expect(parseHubTab(null)).toBe("projects");
    expect(parseHubTab(undefined)).toBe("projects");
    expect(parseHubTab("")).toBe("projects");
    expect(parseHubTab("Overview")).toBe("projects");
    expect(parseHubTab("standup")).toBe("projects");
  });
});

describe("HubTabs", () => {
  it("offers the same views the application navigation lists", () => {
    render(<HubTabs value="projects" onChange={jest.fn()} />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "By project",
      "By function",
      "Overview",
      "Digest",
    ]);
  });

  it("matches the rail's wording, so the two read as one navigation", () => {
    render(<HubTabs value="projects" onChange={jest.fn()} />);
    // Settings is the one entry the rail has that is not a tab here: it is a
    // page of its own rather than a reading of the catalogue, so it leaves
    // rather than switches.
    const labels = TOME_GROUPS.flatMap((group) => group.items)
      .map((item) => item.label)
      .filter((label) => label !== "Settings");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(labels);
  });

  it("carries settings beside the tabs, so the rail's whole set is here", () => {
    render(
      <HubTabs value="projects" onChange={jest.fn()} settingsHref="/projects/admin" />,
    );

    expect(screen.getByRole("link", { name: /Settings/ })).toHaveAttribute(
      "href",
      "/projects/admin",
    );
    // Beside them, not among them: a tab promises a panel below, and this
    // one goes to a page instead.
    expect(screen.getAllByRole("tab")).toHaveLength(4);
  });

  it("leaves the settings link out where no destination is given", () => {
    render(<HubTabs value="projects" onChange={jest.fn()} />);
    expect(screen.queryByRole("link", { name: /Settings/ })).not.toBeInTheDocument();
  });

  it("marks only the open one as selected", () => {
    render(<HubTabs value="digest" onChange={jest.fn()} />);
    expect(screen.getByRole("tab", { name: /Digest/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /Overview/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("reports the tab that was clicked", () => {
    const onChange = jest.fn();
    render(<HubTabs value="projects" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: /Overview/ }));
    expect(onChange).toHaveBeenCalledWith("overview");
  });

  it("names the group, so the project tabs below are a different list", () => {
    render(<HubTabs value="projects" onChange={jest.fn()} />);
    expect(screen.getByRole("tablist")).toHaveAttribute(
      "aria-label",
      "TOME views",
    );
  });
});
