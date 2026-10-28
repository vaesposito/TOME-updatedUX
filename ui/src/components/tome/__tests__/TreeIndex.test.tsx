import { fireEvent, render, screen } from "@testing-library/react";

import { TreeIndex } from "@/components/tome/TreeIndex";
import type { PageTreeNode } from "@/types/tome";

const nodes: PageTreeNode[] = [
  { path: "charter.md", title: "Charter", kind: "stable", order: 0, children: [] },
  {
    path: "planning",
    title: "Planning",
    kind: "folder",
    folderId: "planning",
    order: 1,
    children: [
      { path: "planning/roadmap.md", title: "Roadmap", kind: "dynamic", order: 0, children: [] },
    ],
  },
];

function renderIndex(overrides: Partial<React.ComponentProps<typeof TreeIndex>> = {}) {
  const props = {
    icon: <span />,
    eyebrow: "Wiki",
    title: "Wiki",
    nodes,
    emptyNote: "Nothing written yet.",
    onOpenPage: jest.fn(),
    onOpenFolder: jest.fn(),
    ...overrides,
  };
  render(<TreeIndex {...props} />);
  return props;
}

describe("TreeIndex", () => {
  it("says what the branch is and how much is in it", () => {
    renderIndex();
    expect(screen.getByRole("heading", { name: "Wiki" })).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeInTheDocument();
  });

  it("counts a single child without pluralising", () => {
    renderIndex({ nodes: [nodes[0]] });
    expect(screen.getByText("1 item")).toBeInTheDocument();
  });

  it("opens a page by its path and a folder by its id", () => {
    const props = renderIndex();

    fireEvent.click(screen.getByRole("button", { name: /Charter/ }));
    expect(props.onOpenPage).toHaveBeenCalledWith("charter.md");

    fireEvent.click(screen.getByRole("button", { name: /Planning/ }));
    expect(props.onOpenFolder).toHaveBeenCalledWith("planning");
  });

  it("says what a folder holds rather than repeating its path", () => {
    renderIndex();
    expect(screen.getByText("1 item")).toBeInTheDocument();
    expect(screen.getByText("charter.md")).toBeInTheDocument();
  });

  it("explains an empty branch instead of showing a bare list", () => {
    renderIndex({ nodes: [], emptyNote: "Nothing mirrored yet." });
    expect(screen.getByText("Nothing mirrored yet.")).toBeInTheDocument();
    expect(screen.getByText("0 items")).toBeInTheDocument();
  });

  it("offers a way out of an empty branch", () => {
    const onClick = jest.fn();
    renderIndex({
      nodes: [],
      emptyNote: "Nothing mirrored yet.",
      emptyAction: { label: "Connect a source", onClick },
    });

    fireEvent.click(screen.getByRole("button", { name: "Connect a source" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("carries header actions only when it is given them", () => {
    renderIndex({ actions: <button type="button">New page</button> });
    expect(screen.getByRole("button", { name: "New page" })).toBeInTheDocument();
  });
});
