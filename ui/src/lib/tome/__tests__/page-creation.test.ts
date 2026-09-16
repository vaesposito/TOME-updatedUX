import {
  buildPageCreationAgentPrompt,
  resolveFolderPagePath,
  resolvePageCreationPath,
} from "@/lib/tome/page-creation";

const folders = [
  { id: "testing", parent_id: null, name: "testing", source_path: null },
  { id: "test-folder", parent_id: "testing", name: "Test Folder", source_path: null },
  { id: "foo", parent_id: "test-folder", name: "Foo", source_path: null },
  { id: "bar", parent_id: "foo", name: "Bar", source_path: null },
];

describe("Tome page creation paths", () => {
  it("resolves the full hierarchy for a UI-created nested folder", () => {
    expect(resolveFolderPagePath("bar", folders)).toEqual({
      path: "testing/Test Folder/Foo/Bar",
      breadcrumb: "testing / Test Folder / Foo / Bar",
    });
    expect(resolvePageCreationPath("foo", "bar", folders)).toEqual({
      path: "testing/Test Folder/Foo/Bar/foo.md",
      folderBreadcrumb: "testing / Test Folder / Foo / Bar",
    });
  });

  it("extends the nearest authoritative source path for a new descendant", () => {
    const mixedFolders = [
      { id: "root", parent_id: null, name: "Renamed", source_path: "existing/root" },
      { id: "child", parent_id: "root", name: "Planning", source_path: null },
    ];
    expect(resolvePageCreationPath("q3.md", "child", mixedFolders).path).toBe(
      "existing/root/Planning/q3.md",
    );
  });

  it("does not prefix an already complete path twice", () => {
    expect(
      resolvePageCreationPath(
        "testing/Test Folder/Foo/Bar/foo.md",
        "bar",
        folders,
      ).path,
    ).toBe("testing/Test Folder/Foo/Bar/foo.md");
  });

  it("preserves exact case, spaces, hyphens, and underscores in new paths", () => {
    const exactFolders = [
      { id: "upper", parent_id: null, name: "IOC EXPERIMENTS", source_path: null },
      { id: "hyphen", parent_id: "upper", name: "child-folder", source_path: null },
      { id: "underscore", parent_id: "hyphen", name: "child_folder", source_path: null },
    ];

    expect(resolvePageCreationPath("New Page", "underscore", exactFolders)).toEqual({
      path: "IOC EXPERIMENTS/child-folder/child_folder/New Page.md",
      folderBreadcrumb: "IOC EXPERIMENTS / child-folder / child_folder",
    });
  });

  it("normalizes a leading slash and leaves an unknown folder at the root", () => {
    expect(resolvePageCreationPath("/guide/start.MDX", "missing", folders)).toEqual({
      path: "guide/start.MDX",
      folderBreadcrumb: null,
    });
  });

  it("bounds malformed parent cycles instead of looping", () => {
    const cyclicFolders = [
      { id: "one", parent_id: "two", name: "One", source_path: null },
      { id: "two", parent_id: "one", name: "Two", source_path: null },
    ];

    expect(resolveFolderPagePath("one", cyclicFolders)).toEqual({
      path: "Two/One",
      breadcrumb: "Two / One",
    });
  });

  it("gives the agent an exact authoritative target", () => {
    const prompt = buildPageCreationAgentPrompt({
      projectSlug: "example-project",
      rawPath: "foo.md",
      folderId: "bar",
      folders,
    });

    expect(prompt).toContain(
      "exact wiki-relative path `testing/Test Folder/Foo/Bar/foo.md`",
    );
    expect(prompt).toContain(
      "selected folder breadcrumb is `testing / Test Folder / Foo / Bar`",
    );
    expect(prompt).toContain("do not shorten it");
  });
});
