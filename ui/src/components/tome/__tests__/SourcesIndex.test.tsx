/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";

import { SourcesIndex } from "@/components/tome/SourcesIndex";
import { groupBySource } from "@/lib/tome/sources";
import type { PageTreeNode } from "@/types/tome";

function node(path: string, children: PageTreeNode[] = []): PageTreeNode {
  return {
    path,
    title: path.split("/").pop() ?? path,
    kind: children.length > 0 ? "folder" : "page",
    order: 0,
    children,
  };
}

const MIRRORED = [
  node("repos", [node("repos/example-service"), node("repos/example-ui")]),
  node("confluence", [node("confluence/handbook")]),
];

describe("SourcesIndex", () => {
  it("lists every system, connected or not", () => {
    render(
      <SourcesIndex sources={groupBySource(MIRRORED)} onOpenSource={() => {}} />,
    );

    for (const name of ["GitHub", "Jira", "Confluence", "SharePoint", "Webex"]) {
      expect(screen.getByRole("button", { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  it("says how much of the space came from each one", () => {
    render(
      <SourcesIndex sources={groupBySource(MIRRORED)} onOpenSource={() => {}} />,
    );

    expect(screen.getByRole("button", { name: /GitHub/ })).toHaveTextContent("2 pages");
    expect(screen.getByRole("button", { name: /Confluence/ })).toHaveTextContent("1 page");
  });

  it("tells a system that is not connected from one that is merely empty", () => {
    render(
      <SourcesIndex sources={groupBySource(MIRRORED)} onOpenSource={() => {}} />,
    );

    expect(screen.getByRole("button", { name: /Jira/ })).toHaveTextContent(
      "Not connected",
    );
    // SharePoint can be read from; this space just has not.
    expect(screen.getByRole("button", { name: /SharePoint/ })).toHaveTextContent(
      "0 pages",
    );
  });

  it("counts the connected systems, not the ones offered", () => {
    render(
      <SourcesIndex sources={groupBySource(MIRRORED)} onOpenSource={() => {}} />,
    );

    expect(screen.getByText("2 connected")).toBeInTheDocument();
  });

  it("opens the system that was chosen", () => {
    const opened: string[] = [];
    render(
      <SourcesIndex
        sources={groupBySource(MIRRORED)}
        onOpenSource={(id) => opened.push(id)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Confluence/ }));

    expect(opened).toEqual(["confluence"]);
  });
});
