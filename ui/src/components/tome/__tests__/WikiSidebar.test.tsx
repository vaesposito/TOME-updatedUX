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

describe("WikiSidebar selection", () => {
  const folderTree: PageTreeNode[] = [
    {
      path: "collateral",
      title: "Collateral",
      kind: "folder",
      order: 0,
      folderId: "folder-collateral",
      children: [
        {
          path: "collateral/brief.md",
          title: "Brief",
          kind: "stable",
          order: 0,
          children: [],
        },
      ],
    },
  ];

  it("draws no checkbox where there is nowhere for a tick to go", () => {
    render(
      <WikiSidebar
        tree={tree}
        selectedPath={null}
        onSelect={jest.fn()}
        showHidden={false}
      />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("offers a tick for every page once asked", () => {
    render(
      <WikiSidebar
        tree={tree}
        selectedPath={null}
        onSelect={jest.fn()}
        showHidden={false}
        checkedPaths={new Set()}
        onCheckedChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Select Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Bravo" })).toBeInTheDocument();
  });

  it("offers a tick for folders and the pages inside them", () => {
    render(
      <WikiSidebar
        tree={folderTree}
        selectedPath={null}
        onSelect={jest.fn()}
        showHidden={false}
        checkedPaths={new Set()}
        onCheckedChange={jest.fn()}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: "Select Collateral" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand Collateral" }));
    expect(screen.getByRole("checkbox", { name: "Select Brief" })).toBeInTheDocument();
  });

  it("shows which paths are already ticked", () => {
    render(
      <WikiSidebar
        tree={tree}
        selectedPath={null}
        onSelect={jest.fn()}
        showHidden={false}
        checkedPaths={new Set(["alpha.md"])}
        onCheckedChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Select Alpha" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Bravo" })).not.toBeChecked();
  });

  it("reports a tick and an untick", () => {
    const onCheckedChange = jest.fn();
    render(
      <WikiSidebar
        tree={tree}
        selectedPath={null}
        onSelect={jest.fn()}
        showHidden={false}
        checkedPaths={new Set(["bravo.md"])}
        onCheckedChange={onCheckedChange}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    expect(onCheckedChange).toHaveBeenCalledWith("alpha.md", true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Bravo" }));
    expect(onCheckedChange).toHaveBeenCalledWith("bravo.md", false);
  });

  it("does not open the page it was asked to tick", () => {
    const onSelect = jest.fn();
    render(
      <WikiSidebar
        tree={tree}
        selectedPath={null}
        onSelect={onSelect}
        showHidden={false}
        checkedPaths={new Set()}
        onCheckedChange={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("still opens a page when the row itself is clicked", () => {
    const onSelect = jest.fn();
    render(
      <WikiSidebar
        tree={tree}
        selectedPath={null}
        onSelect={onSelect}
        showHidden={false}
        checkedPaths={new Set()}
        onCheckedChange={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    expect(onSelect).toHaveBeenCalledWith("alpha.md");
  });
});

describe("WikiSidebar row metadata", () => {
  const kinds: PageTreeNode[] = [
    { path: "charter.md", title: "Charter", kind: "stable", order: 0, children: [] },
    { path: "roadmap.md", title: "Roadmap", kind: "dynamic", order: 1, children: [] },
    {
      path: "notes",
      title: "Notes",
      kind: "folder",
      folderId: "notes",
      order: 2,
      children: [
        { path: "notes/one.md", title: "One", kind: "stable", order: 0, children: [] },
      ],
    },
  ];

  const base = {
    tree: kinds,
    selectedPath: null,
    onSelect: jest.fn(),
    showHidden: false,
  };

  it("reports kind and size where pages are being surveyed", () => {
    render(<WikiSidebar {...base} showMeta />);
    expect(screen.getAllByLabelText("stable").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("dynamic")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("drops the kind badge where the tree is a list of places to go", () => {
    // A page's kind is chosen on the page, so a badge here only reports a
    // setting, and it does not help anyone decide where to go. How much is
    // in a folder does, so that stays.
    render(<WikiSidebar {...base} showMeta={false} />);
    expect(screen.queryByLabelText("stable")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("dynamic")).not.toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("still names every row", () => {
    render(<WikiSidebar {...base} showMeta={false} />);
    expect(screen.getByText("Charter")).toBeInTheDocument();
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
  });
});

describe("WikiSidebar nesting", () => {
  const tree: PageTreeNode[] = [
    { path: "charter.md", title: "Charter", kind: "stable", order: 0, children: [] },
    {
      path: "demos",
      title: "demos",
      kind: "folder",
      folderId: "demos",
      order: 1,
      children: [
        { path: "demos/one.md", title: "One", kind: "stable", order: 0, children: [] },
      ],
    },
  ];

  /** The left padding a row's own indent puts on it, in pixels. */
  function padding(name: string): number {
    const row = screen.getByRole("button", { name });
    const indented = row.style.paddingLeft ? row : row.closest("[style*='padding-left']");
    return Number.parseInt((indented as HTMLElement).style.paddingLeft, 10);
  }

  it("clears a child of its parent's title, not just of the folder mark", () => {
    render(<WikiSidebar tree={tree} selectedPath={null} onSelect={jest.fn()} showHidden={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand demos" }));

    // A folder spends the head of its own indent on its mark, so a step only
    // as wide as that mark would put the child exactly under the parent's
    // title and the nesting would read as nothing. The step has to be wider
    // than the mark for a child to look like a child.
    const markWidth = 16;
    expect(padding("One") - padding("demos")).toBeGreaterThan(markWidth);
  });

  it("starts a folder where a sibling page starts", () => {
    render(<WikiSidebar tree={tree} selectedPath={null} onSelect={jest.fn()} showHidden={false} />);
    expect(padding("demos")).toBe(padding("Charter"));
  });

  it("starts folded, so the rail opens on what the team wrote", () => {
    render(<WikiSidebar tree={tree} selectedPath={null} onSelect={jest.fn()} showHidden={false} />);

    expect(screen.getByRole("button", { name: "demos" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("One")).not.toBeInTheDocument();
  });

  it("shows the reader where they are, however folded the branch holding them", () => {
    // Otherwise arriving on a nested page from a link leaves a tree that
    // admits to nothing being open.
    render(
      <WikiSidebar
        tree={tree}
        selectedPath="demos/one.md"
        onSelect={jest.fn()}
        showHidden={false}
      />,
    );

    expect(screen.getByRole("button", { name: "demos" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("One")).toBeInTheDocument();
  });
});

describe("WikiSidebar empty folders", () => {
  const tree: PageTreeNode[] = [
    {
      path: "decisions",
      title: "Decisions",
      kind: "folder",
      folderId: "decisions",
      order: 0,
      children: [],
    },
    {
      path: "notes",
      title: "Notes",
      kind: "folder",
      folderId: "notes",
      order: 1,
      children: [
        { path: "notes/one.md", title: "One", kind: "stable", order: 0, children: [] },
      ],
    },
  ];

  const base = {
    tree,
    selectedPath: null,
    onSelect: jest.fn(),
    showHidden: false,
  };

  it("counts a folder rather than making it be opened to find out", () => {
    render(<WikiSidebar {...base} />);
    // One mark for both answers, so a reader going down the tree is reading
    // a column of figures rather than a word here and a number there.
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("offers no caret on a folder with nothing under it", () => {
    render(<WikiSidebar {...base} />);

    expect(
      screen.queryByRole("button", { name: /Expand Decisions|Collapse Decisions/ }),
    ).not.toBeInTheDocument();
    // The folder that does hold something keeps its caret.
    expect(
      screen.getByRole("button", { name: /Expand Notes|Collapse Notes/ }),
    ).toBeInTheDocument();
  });

  it("says nought of the empty folder only", () => {
    render(<WikiSidebar {...base} />);
    expect(screen.getAllByText("0")).toHaveLength(1);
  });

  it("goes to a folder and opens it from the row, the way the rail's sections do", () => {
    const onSelectFolder = jest.fn();
    render(<WikiSidebar {...base} onSelectFolder={onSelectFolder} />);

    const row = screen.getByRole("button", { name: "Notes" });
    expect(row).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(row);
    expect(onSelectFolder).toHaveBeenCalledWith("notes");
    expect(screen.getByRole("button", { name: "Notes" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "One" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    expect(screen.queryByRole("button", { name: "One" })).not.toBeInTheDocument();
  });

  it("does not claim to open a folder it has just called empty", () => {
    const onSelectFolder = jest.fn();
    render(<WikiSidebar {...base} onSelectFolder={onSelectFolder} />);

    const row = screen.getByRole("button", { name: "Decisions" });
    expect(row).not.toHaveAttribute("aria-expanded");

    // It still goes there: the folder's own page is where an empty folder
    // explains itself and offers the way to fill it.
    fireEvent.click(row);
    expect(onSelectFolder).toHaveBeenCalledWith("decisions");
  });
});

describe("WikiSidebar folder colour", () => {
  it("gives a folder the pages' own colour, and lightens only an empty one", () => {
    const full: PageTreeNode = {
      path: "notes",
      title: "Notes",
      kind: "folder",
      order: 0,
      folderId: "notes",
      children: [
        { path: "notes/alpha.md", title: "Alpha", kind: "stable", order: 0, children: [] },
      ],
    };
    const bare: PageTreeNode = {
      path: "archive",
      title: "Archive",
      kind: "folder",
      order: 1,
      folderId: "archive",
      children: [],
    };

    render(
      <WikiSidebar
        tree={[full, bare]}
        selectedPath={null}
        onSelect={jest.fn()}
        showHidden={false}
      />,
    );

    const row = (name: string) =>
      screen.getByText(name).closest("div[class*='group']")?.className ?? "";
    expect(row("Notes")).toContain("text-foreground");
    expect(row("Notes")).not.toContain("text-muted-foreground/60");
    expect(row("Archive")).toContain("text-muted-foreground/60");
  });
});

describe("WikiSidebar page actions", () => {
  const tree: PageTreeNode[] = [
    {
      path: "meetings",
      title: "Meetings",
      kind: "folder",
      folderId: "meetings",
      order: 0,
      children: [
        {
          path: "meetings/17.08.2026.md",
          title: "17.08.2026",
          kind: "stable",
          order: 0,
          children: [],
        },
      ],
    },
  ];

  const base = {
    tree,
    selectedPath: "meetings/17.08.2026.md",
    onSelect: jest.fn(),
    showHidden: false,
  };

  it("renames a page from its own row", async () => {
    const onRenamePage = jest.fn();
    render(<WikiSidebar {...base} onRenamePage={onRenamePage} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Actions for 17.08.2026" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /Rename/ }));

    // The page is named by its path, which is what the rename acts on.
    expect(onRenamePage).toHaveBeenCalledWith("meetings/17.08.2026.md");
  });

  it("keeps the menu out of the way until the row is reached", () => {
    render(<WikiSidebar {...base} onRenamePage={jest.fn()} />);

    // Present for the keyboard, invisible to a reader going down the tree.
    expect(
      screen.getByRole("button", { name: "Actions for 17.08.2026" }).className,
    ).toContain("opacity-0");
  });

  it("offers no menu where there is nothing to do with a page", () => {
    render(<WikiSidebar {...base} />);

    expect(
      screen.queryByRole("button", { name: "Actions for 17.08.2026" }),
    ).not.toBeInTheDocument();
  });

  it("leaves folders to the edit action their rows already carry", () => {
    const onEditFolder = jest.fn();
    render(
      <WikiSidebar {...base} onRenamePage={jest.fn()} onEditFolder={onEditFolder} />,
    );

    // A second way to rename a folder would be a second thing to keep in step
    // with the first.
    expect(
      screen.queryByRole("button", { name: "Actions for Meetings" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Meetings" }),
    ).toBeInTheDocument();
  });
});
