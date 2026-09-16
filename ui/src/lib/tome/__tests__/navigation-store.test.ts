const mockFolderFind = jest.fn();
const mockFolderBulkWrite = jest.fn();
const mockPlacementFind = jest.fn();
const mockPlacementUpdateOne = jest.fn();
const mockPlacementBulkWrite = jest.fn();
const mockPlacementDeleteMany = jest.fn();
const mockUpdateFolder = jest.fn();

jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeFoldersCollection: jest.fn(async () => ({
    find: (...args: unknown[]) => mockFolderFind(...args),
    bulkWrite: (...args: unknown[]) => mockFolderBulkWrite(...args),
  })),
  getTomePagePlacementsCollection: jest.fn(async () => ({
    createIndex: jest.fn().mockResolvedValue("index"),
    find: (...args: unknown[]) => mockPlacementFind(...args),
    updateOne: (...args: unknown[]) => mockPlacementUpdateOne(...args),
    bulkWrite: (...args: unknown[]) => mockPlacementBulkWrite(...args),
    deleteMany: (...args: unknown[]) => mockPlacementDeleteMany(...args),
  })),
}));
jest.mock("@/lib/tome/folder-store", () => ({
  updateFolder: (...args: unknown[]) => mockUpdateFolder(...args),
}));

import {
  ensurePagePlacements,
  moveNavigationItem,
} from "@/lib/tome/navigation-store";

describe("Tome navigation placement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFolderFind.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
    mockPlacementUpdateOne.mockResolvedValue({ acknowledged: true });
    mockPlacementBulkWrite.mockResolvedValue({ acknowledged: true });
    mockPlacementDeleteMany.mockResolvedValue({ acknowledged: true });
    mockFolderBulkWrite.mockResolvedValue({ acknowledged: true });
    mockUpdateFolder.mockResolvedValue({ acknowledged: true });
  });

  it("backfills missing placements from exact source paths without replacing user choices", async () => {
    mockPlacementFind.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          project_id: "project-primary",
          path: "IOC EXPERIMENTS/MAD.md",
          folder_id: "folder-manual",
          order: 4,
        },
        {
          project_id: "project-primary",
          path: "stale.md",
          folder_id: null,
          order: 5,
        },
      ]),
    });

    await ensurePagePlacements(
      "project-primary",
      {
        "IOC EXPERIMENTS/MAD.md": "# MAD\n",
        "ioc-experiments/chatdev.md": "---\norder: 7\n---\n# Chatdev\n",
      },
      [
        {
          id: "folder-uppercase",
          project_id: "project-primary",
          parent_id: null,
          name: "IOC EXPERIMENTS",
          name_key: "ioc experiments",
          source_path: "IOC EXPERIMENTS",
          order: 0,
          owner_subject: "test-user@example.com",
          permission_scope: "project",
          created_at: new Date(),
          updated_at: new Date(),
          updated_by: "test-user@example.com",
        },
        {
          id: "folder-hyphen",
          project_id: "project-primary",
          parent_id: null,
          name: "ioc-experiments",
          name_key: "ioc-experiments",
          source_path: "ioc-experiments",
          order: 1,
          owner_subject: "test-user@example.com",
          permission_scope: "project",
          created_at: new Date(),
          updated_at: new Date(),
          updated_by: "test-user@example.com",
        },
      ],
      "test-user@example.com",
    );

    const operations = mockPlacementBulkWrite.mock.calls[0][0];
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      updateOne: {
        filter: { project_id: "project-primary", path: "ioc-experiments/chatdev.md" },
        update: { $setOnInsert: { folder_id: "folder-hyphen", order: 7 } },
        upsert: true,
      },
    });
    expect(mockPlacementDeleteMany).toHaveBeenCalledWith({
      project_id: "project-primary",
      path: { $nin: ["IOC EXPERIMENTS/MAD.md", "ioc-experiments/chatdev.md"] },
    });
  });

  it("reorders pages relative to another page without changing their paths", async () => {
    mockPlacementFind.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { project_id: "project-primary", path: "alpha.md", folder_id: null, order: 0 },
        { project_id: "project-primary", path: "bravo.md", folder_id: null, order: 1 },
        { project_id: "project-primary", path: "charlie.md", folder_id: null, order: 2 },
      ]),
    });

    await moveNavigationItem({
      projectId: "project-primary",
      item: { kind: "page", id: "alpha.md" },
      target: { position: "after", item: { kind: "page", id: "bravo.md" } },
      actor: "test-user@example.com",
    });

    expect(mockPlacementUpdateOne).toHaveBeenCalledWith(
      { project_id: "project-primary", path: "alpha.md" },
      { $set: expect.objectContaining({ folder_id: null }) },
    );
    const operations = mockPlacementBulkWrite.mock.calls[0][0] as Array<{
      updateOne: { filter: { path: string }; update: { $set: { order: number } } };
    }>;
    expect(operations.map((operation) => [
      operation.updateOne.filter.path,
      operation.updateOne.update.$set.order,
    ])).toEqual([
      ["bravo.md", 0],
      ["alpha.md", 1],
      ["charlie.md", 2],
    ]);
  });

  it("moves a page inside a folder while retaining its URL path", async () => {
    mockFolderFind.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { id: "folder-planning", project_id: "project-primary", parent_id: null, order: 0 },
      ]),
    });
    mockPlacementFind.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { project_id: "project-primary", path: "alpha.md", folder_id: null, order: 1 },
      ]),
    });

    await moveNavigationItem({
      projectId: "project-primary",
      item: { kind: "page", id: "alpha.md" },
      target: { position: "inside", item: { kind: "folder", id: "folder-planning" } },
      actor: "test-user@example.com",
    });

    expect(mockPlacementUpdateOne).toHaveBeenCalledWith(
      { project_id: "project-primary", path: "alpha.md" },
      { $set: expect.objectContaining({ folder_id: "folder-planning" }) },
    );
  });

  it("moves a folder through the cycle-safe folder update path", async () => {
    mockFolderFind.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { id: "folder-alpha", project_id: "project-primary", parent_id: null, order: 0 },
        { id: "folder-bravo", project_id: "project-primary", parent_id: null, order: 1 },
      ]),
    });
    mockPlacementFind.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

    await moveNavigationItem({
      projectId: "project-primary",
      item: { kind: "folder", id: "folder-alpha" },
      target: { position: "inside", item: { kind: "folder", id: "folder-bravo" } },
      actor: "test-user@example.com",
    });

    expect(mockUpdateFolder).toHaveBeenCalledWith({
      projectId: "project-primary",
      folderId: "folder-alpha",
      parentId: "folder-bravo",
      actor: "test-user@example.com",
    });
  });

  it("rejects missing items, missing targets, and pages used as containers", async () => {
    mockFolderFind.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
    mockPlacementFind.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { project_id: "project-primary", path: "alpha.md", folder_id: null, order: 0 },
        { project_id: "project-primary", path: "bravo.md", folder_id: null, order: 1 },
      ]),
    });

    await expect(moveNavigationItem({
      projectId: "project-primary",
      item: { kind: "page", id: "missing.md" },
      target: { position: "root" },
      actor: "test-user@example.com",
    })).rejects.toMatchObject({ code: "NAVIGATION_ITEM_NOT_FOUND", status: 404 });
    await expect(moveNavigationItem({
      projectId: "project-primary",
      item: { kind: "page", id: "alpha.md" },
      target: { position: "after", item: { kind: "folder", id: "folder-missing" } },
      actor: "test-user@example.com",
    })).rejects.toMatchObject({ code: "NAVIGATION_TARGET_NOT_FOUND", status: 404 });
    await expect(moveNavigationItem({
      projectId: "project-primary",
      item: { kind: "page", id: "alpha.md" },
      target: { position: "inside", item: { kind: "page", id: "bravo.md" } },
      actor: "test-user@example.com",
    })).rejects.toMatchObject({ code: "INVALID_NAVIGATION_TARGET", status: 400 });
  });
});
