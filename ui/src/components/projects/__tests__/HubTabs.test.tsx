/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

import { HubTabs, parseHubTab } from "@/components/projects/HubTabs";

describe("parseHubTab", () => {
  it("reads the three it knows", () => {
    expect(parseHubTab("projects")).toBe("projects");
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
  it("offers the three views", () => {
    render(<HubTabs value="projects" onChange={jest.fn()} />);
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: /Projects/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Overview/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Digest/ })).toBeInTheDocument();
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
