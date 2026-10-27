import { fireEvent, render, screen } from "@testing-library/react";

import { WikiContentManager } from "@/components/tome/WikiContentManager";
import type { PageTreeNode } from "@/types/tome";

function node(path: string, kind: PageTreeNode["kind"] = "page"): PageTreeNode {
  return {
    path,
    title: path,
    kind,
    order: 0,
    children: [],
    ...(kind === "folder" ? { folderId: `folder-${path}` } : {}),
  };
}

function setup(overrides: Partial<React.ComponentProps<typeof WikiContentManager>> = {}) {
  const props = {
    toolbar: <button type="button">New page</button>,
    tree: <div data-testid="tree">tree</div>,
    query: "",
    onQueryChange: jest.fn(),
    checked: [] as readonly PageTreeNode[],
    busy: false,
    folders: [
      { id: "folder-charter", name: "Charter" },
      { id: "folder-notes", name: "Notes" },
    ],
    onClear: jest.fn(),
    onMove: jest.fn(),
    onDelete: jest.fn(),
    ...overrides,
  };
  render(<WikiContentManager {...props} />);
  return props;
}

describe("WikiContentManager", () => {
  it("stays quiet until something is ticked", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Move to" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    expect(screen.getByTestId("tree")).toBeInTheDocument();
  });

  it("counts what is ticked", () => {
    setup({ checked: [node("charter"), node("roadmap")] });
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("says item rather than items for one", () => {
    setup({ checked: [node("charter")] });
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(screen.getByRole("heading", { name: "Delete 1 item?" })).toBeInTheDocument();
  });

  it("names what it is about to remove rather than counting it", () => {
    setup({ checked: [node("charter"), node("roadmap")] });
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(
      screen.getByText(/This removes charter, roadmap\./),
    ).toBeInTheDocument();
  });

  it("warns that a folder takes its contents with it", () => {
    setup({ checked: [node("collateral", "folder")] });
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(
      screen.getByText(/everything inside the folders among them/),
    ).toBeInTheDocument();
  });

  it("deletes only once the confirmation is answered", () => {
    const props = setup({ checked: [node("charter")] });
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(props.onDelete).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Delete" }).slice(-1)[0]!,
    );
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it("does not delete when the confirmation is dismissed", () => {
    const props = setup({ checked: [node("charter")] });
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("offers the top level and every folder as a destination", () => {
    setup({ checked: [node("charter")] });
    fireEvent.click(screen.getByRole("button", { name: "Move to" }));
    expect(screen.getByRole("button", { name: "Top level" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Charter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notes" })).toBeInTheDocument();
  });

  it("does not offer a selected folder as its own destination", () => {
    setup({
      checked: [{ ...node("charter", "folder"), folderId: "folder-charter" }],
      folders: [
        { id: "folder-charter", name: "Charter" },
        { id: "folder-notes", name: "Notes" },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Move to" }));
    expect(screen.queryByRole("button", { name: "Charter" })).toBeNull();
    expect(screen.getByRole("button", { name: "Notes" })).toBeInTheDocument();
    // The top level is always somewhere to go.
    expect(screen.getByRole("button", { name: "Top level" })).toBeInTheDocument();
  });

  it("reports the destination chosen", () => {
    const props = setup({ checked: [node("charter")] });
    fireEvent.click(screen.getByRole("button", { name: "Move to" }));
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    expect(props.onMove).toHaveBeenCalledWith("folder-notes");
  });

  it("reports the top level as no folder at all", () => {
    const props = setup({ checked: [node("charter")] });
    fireEvent.click(screen.getByRole("button", { name: "Move to" }));
    fireEvent.click(screen.getByRole("button", { name: "Top level" }));
    expect(props.onMove).toHaveBeenCalledWith(null);
  });

  it("refuses a second instruction while one is in flight", () => {
    setup({ checked: [node("charter")], busy: true });
    expect(screen.getByRole("button", { name: "Move to" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("passes the search straight back out", () => {
    const props = setup();
    fireEvent.change(screen.getByLabelText("Search pages and folders"), {
      target: { value: "charter" },
    });
    expect(props.onQueryChange).toHaveBeenCalledWith("charter");
  });

  it("says where the page type is chosen, since it is not here", () => {
    setup();
    expect(
      screen.getByText(/whether it is stable or dynamic, are settled on the page itself/),
    ).toBeInTheDocument();
  });
});
