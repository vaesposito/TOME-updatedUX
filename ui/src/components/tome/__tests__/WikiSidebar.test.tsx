import { fireEvent, render, screen } from "@testing-library/react";

import { WikiSidebar } from "@/components/tome/WikiSidebar";
import { buildTree } from "@/lib/tome/schema";
import type { PageTreeNode } from "@/types/tome";

const tree: PageTreeNode[] = [
  { path: "alpha.md", title: "Alpha", kind: "stable", order: 0, children: [] },
  { path: "bravo.md", title: "Bravo", kind: "stable", order: 1, children: [] },
];

describe("WikiSidebar drag and drop", () => {
  it("moves a page to the wiki root through its drag handle", () => {
    const onMoveItem = jest.fn();
    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "none",
      dropEffect: "none",
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? "",
    };
    render(
      <WikiSidebar
        tree={tree}
        selectedPath={null}
        onSelect={jest.fn()}
        showHidden={false}
        onMoveItem={onMoveItem}
      />,
    );

    fireEvent.dragStart(screen.getByRole("button", { name: "Move Alpha" }), { dataTransfer });
    const rootTarget = screen.getByText("Drop here to move to wiki root");
    fireEvent.dragOver(rootTarget, { dataTransfer });
    fireEvent.drop(rootTarget, { dataTransfer });

    expect(onMoveItem).toHaveBeenCalledWith(
      { kind: "page", id: "alpha.md" },
      { position: "root" },
    );
  });

  it("offers a contextual new-page action for persisted folders", () => {
    const onCreatePage = jest.fn();
    const folder: PageTreeNode = {
      path: "@folder/folder-1",
      title: "Planning",
      kind: "folder",
      order: 0,
      folderId: "folder-1",
      children: [],
    };
    render(
      <WikiSidebar
        tree={[folder]}
        selectedPath={null}
        onSelect={jest.fn()}
        showHidden={false}
        onCreatePage={onCreatePage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New page in Planning" }));
    expect(onCreatePage).toHaveBeenCalledWith(folder);
    expect(screen.queryByRole("button", { name: "Move Planning up" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move Planning down" })).not.toBeInTheDocument();
  });
});

describe("SharePoint document navigation", () => {
  const path = "sharepoint/doc-example.md";
  const pages = { [path]: "---\ntitle: Garden Survey.pdf\nkind: dynamic\norder: 0\n---\n## Summary\n\nDocument summary." };

  it("groups dedicated document pages in a collapsed SharePoint folder with its logo", () => {
    const onSelect = jest.fn();
    const { container } = render(<WikiSidebar tree={buildTree(pages)} selectedPath={null} onSelect={onSelect} showHidden={false} />);
    expect(screen.getByText("SharePoint")).toBeInTheDocument();
    expect(container.querySelector('img[src="/provider-logos/sharepoint.svg"]')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Garden Survey.pdf" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand SharePoint" }));
    fireEvent.click(screen.getByRole("button", { name: "Garden Survey.pdf" }));
    expect(onSelect).toHaveBeenCalledWith(path);
  });

  it("keeps the logo and dedicated pages when the source folder is persisted", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const folderTree = buildTree(pages, [{ id: "folder-source", project_id: "project-1", parent_id: null,
      name: "SharePoint", name_key: "sharepoint", source_path: "sharepoint", order: 999,
      owner_subject: "test-user@example.com", permission_scope: "project", created_at: now, updated_at: now, updated_by: "test-user@example.com" }]);
    const { container } = render(<WikiSidebar tree={folderTree} selectedPath={null} onSelect={jest.fn()} showHidden={false} />);
    expect(container.querySelector('img[src="/provider-logos/sharepoint.svg"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand SharePoint" }));
    expect(screen.getByRole("button", { name: "Garden Survey.pdf" })).toBeInTheDocument();
    expect(folderTree[0].folderId).toBe("folder-source");
  });
});
