/** @jest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import * as React from "react";

import { HomeChildren } from "@/components/tome/home/HomeChildren";

const rows = {
  children: [
    {
      slug: "example-goal",
      title: "Example Goal",
      type: "bhag" as const,
      page_count: 0,
      last_ingested_at: null,
      last_edited_at: null,
      ingesting: null,
    },
    {
      slug: "example-area",
      title: "Example Area",
      type: "area" as const,
      parent_slug: "example-goal",
      page_count: 3,
      last_ingested_at: null,
      last_edited_at: "2026-10-12T00:00:00.000Z",
      ingesting: null,
    },
  ],
  total: 2,
  withheld: 0,
};

describe("HomeChildren given its rows", () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ data: rows }) }),
    ) as unknown as typeof fetch;
  });

  it("does not read them again", () => {
    // The workspace overview fetches the spaces and the digest together,
    // because it needs both and they come out of one read.
    render(
      <HomeChildren kind="workspace" settingsHref="/projects" rows={rows} />,
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText("Example Area")).toBeInTheDocument();
  });

  it("keeps the workspace reading open behind a row, when asked to", () => {
    const { rerender } = render(
      <HomeChildren kind="workspace" settingsHref="/projects" rows={rows} />,
    );
    expect(screen.getByRole("link", { name: /Example Area/ })).not.toHaveAttribute("target");

    rerender(
      <HomeChildren kind="workspace" settingsHref="/projects" rows={rows} newTab />,
    );
    const link = screen.getByRole("link", { name: /Example Area/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("still fetches for a container that only knows its slug", async () => {
    render(
      <HomeChildren
        kind="bhag"
        slug="example-goal"
        settingsHref="/projects/example-goal/tome/settings"
      />,
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain(
      "/api/tome/projects/example-goal/children",
    );
  });

  it("counts what is waiting against the tallies it was given", () => {
    render(
      <HomeChildren
        kind="workspace"
        settingsHref="/projects"
        rows={rows}
        entities={[
          { slug: "example-area", title: "Example Area", type: "area", attention: 2 },
        ]}
      />,
    );
    expect(screen.getByText(/2 things are waiting/)).toBeInTheDocument();
  });

  it("says nothing is there yet in workspace terms", () => {
    render(
      <HomeChildren
        kind="workspace"
        settingsHref="/projects"
        rows={{ children: [], total: 0, withheld: 0 }}
      />,
    );
    expect(screen.getByText("No spaces yet")).toBeInTheDocument();
    // Not "nothing below this", which would imply a space it is below.
    expect(screen.queryByText("Nothing below this yet")).not.toBeInTheDocument();
  });
});
