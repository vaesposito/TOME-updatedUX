jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeFoldersCollection: jest.fn(),
}));

import { getTomeFoldersCollection } from "@/lib/tome/mongo-collections";
import {
  createFolder,
  ensureFoldersForPages,
  folderMoveWouldCycle,
} from "@/lib/tome/folder-store";
import { buildTree } from "@/lib/tome/schema";
import type { TomeFolder, TomePagePlacement } from "@/types/tome";

function folder(input: Partial<TomeFolder> & Pick<TomeFolder, "id" | "name">): TomeFolder {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    project_id: "project-primary",
    parent_id: null,
    name_key: input.name.toLocaleLowerCase(),
    source_path: null,
    order: 0,
    owner_subject: "test-user@example.com",
    permission_scope: "project",
    created_at: now,
    updated_at: now,
    updated_by: "test-user@example.com",
    ...input,
  };
}

function placement(
  path: string,
  folderId: string | null,
  order: number,
): TomePagePlacement {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    project_id: "project-primary",
    path,
    folder_id: folderId,
    order,
    created_at: now,
    updated_at: now,
    updated_by: "test-user@example.com",
  };
}

describe("first-class Tome folders", () => {
  it.each([
    ["", "FOLDER_NAME_REQUIRED"],
    ["   ", "FOLDER_NAME_REQUIRED"],
    ["parent/child", "INVALID_FOLDER_NAME"],
    ["parent\0child", "INVALID_FOLDER_NAME"],
    [".", "INVALID_FOLDER_NAME"],
    ["..", "INVALID_FOLDER_NAME"],
    ["x".repeat(121), "FOLDER_NAME_TOO_LONG"],
  ])("rejects an invalid manual folder name %#", async (name, code) => {
    await expect(createFolder({
      projectId: "project-primary",
      parentId: null,
      name,
      actor: "test-user@example.com",
    })).rejects.toMatchObject({ code, status: 400 });
  });

  it("keeps exact source path distinctions when materializing folders", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const folders: TomeFolder[] = [
      {
        id: "folder-uppercase",
        project_id: "project-primary",
        parent_id: null,
        name: "Ioc Experiments",
        name_key: "ioc experiments",
        source_path: "IOC EXPERIMENTS",
        order: 999,
        owner_subject: "test-user@example.com",
        permission_scope: "project",
        created_at: now,
        updated_at: now,
        updated_by: "test-user@example.com",
      },
    ];
    const createIndex = jest.fn().mockResolvedValue("index");
    const find = jest.fn(() => ({
      toArray: jest.fn(async () => [...folders]),
    }));
    const updateOne = jest.fn(async (
      filter: { id: string },
      update: { $set?: Partial<TomeFolder>; $setOnInsert?: TomeFolder },
      options?: { upsert?: boolean },
    ) => {
      const current = folders.find((folder) => folder.id === filter.id);
      if (current && update.$set) Object.assign(current, update.$set);
      if (!current && options?.upsert && update.$setOnInsert) folders.push(update.$setOnInsert);
      return { acknowledged: true };
    });
    (getTomeFoldersCollection as jest.Mock).mockResolvedValue({ createIndex, find, updateOne });

    await ensureFoldersForPages(
      "project-primary",
      ["IOC EXPERIMENTS/overview.md", "ioc-experiments/overview.md"],
      "test-user@example.com",
    );

    expect(folders.map((folder) => [
      folder.name,
      folder.source_path,
      folder.name_key,
      folder.display_name_key,
    ])).toEqual([
      ["Ioc Experiments", "IOC EXPERIMENTS", "ioc experiments", undefined],
      ["ioc-experiments", "ioc-experiments", "ioc-experiments", "ioc-experiments"],
    ]);
    expect(createIndex).toHaveBeenLastCalledWith(
      { project_id: 1, source_path: 1 },
      { unique: true, partialFilterExpression: { source_path: { $type: "string" } } },
    );
  });

  it("keeps a stable folder identity while its display name changes", () => {
    const pages = { "guides/start.md": "# Start\n" };
    const tree = buildTree(pages, [
      folder({ id: "folder-guides", name: "Handbook", source_path: "guides" }),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      path: "guides",
      title: "Handbook",
      folderId: "folder-guides",
    });
    expect(tree[0].children[0]).toMatchObject({ path: "guides/start.md", title: "Start" });
  });

  it("renders empty folders and persisted hierarchy independently of page paths", () => {
    const tree = buildTree(
      { "guides/start.md": "# Start\n" },
      [
        folder({ id: "folder-planning", name: "Planning" }),
        folder({
          id: "folder-guides",
          name: "Guides",
          source_path: "guides",
          parent_id: "folder-planning",
        }),
        folder({ id: "folder-empty", name: "Empty folder", order: 1 }),
      ],
    );

    expect(tree.map((node) => node.title)).toEqual(["Planning", "Empty folder"]);
    expect(tree[0].children[0]).toMatchObject({ title: "Guides", folderId: "folder-guides" });
    expect(tree[0].children[0].children[0].path).toBe("guides/start.md");
  });

  it("rejects moves into the folder itself or a descendant", () => {
    const folders = [
      folder({ id: "folder-parent", name: "Parent" }),
      folder({ id: "folder-child", name: "Child", parent_id: "folder-parent" }),
      folder({ id: "folder-grandchild", name: "Grandchild", parent_id: "folder-child" }),
    ];

    expect(folderMoveWouldCycle("folder-parent", "folder-parent", folders)).toBe(true);
    expect(folderMoveWouldCycle("folder-parent", "folder-grandchild", folders)).toBe(true);
    expect(folderMoveWouldCycle("folder-child", null, folders)).toBe(false);
  });

  it("places and orders pages independently of their Markdown path", () => {
    const pages = {
      "alpha.md": "# Alpha\n",
      "bravo.md": "# Bravo\n",
    };
    const folders = [folder({ id: "folder-planning", name: "Planning", order: 1 })];
    const tree = buildTree(pages, folders, [
      placement("alpha.md", null, 2),
      placement("bravo.md", "folder-planning", 0),
    ]);

    expect(tree.map((node) => node.title)).toEqual(["Planning", "Alpha"]);
    expect(tree[0].children[0]).toMatchObject({
      path: "bravo.md",
      title: "Bravo",
      parentFolderId: "folder-planning",
    });
  });
});
