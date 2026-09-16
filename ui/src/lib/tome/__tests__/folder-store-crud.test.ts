const mockGetFolders = jest.fn();
const mockGetPlacements = jest.fn();

jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeFoldersCollection: (...args: unknown[]) => mockGetFolders(...args),
  getTomePagePlacementsCollection: (...args: unknown[]) => mockGetPlacements(...args),
}));

import {
  createFolder,
  deleteFolder,
  reorderFolder,
  updateFolder,
} from "@/lib/tome/folder-store";
import type { TomeFolder } from "@/types/tome";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function folder(input: Partial<TomeFolder> & Pick<TomeFolder, "id" | "name">): TomeFolder {
  return {
    project_id: "project-primary",
    parent_id: null,
    name_key: input.name.toLocaleLowerCase(),
    display_name_key: input.name,
    folder_schema_version: 2,
    source_path: null,
    order: 0,
    owner_subject: "test-user@example.com",
    permission_scope: "project",
    created_at: NOW,
    updated_at: NOW,
    updated_by: "test-user@example.com",
    ...input,
  };
}

function matches(document: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => document[key] === value);
}

function duplicateKeyError(): Error & { code: number } {
  return Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
}

describe("Tome folder persistence", () => {
  let folders: TomeFolder[];
  let placements: Array<{ project_id: string; path: string; folder_id: string | null }>;
  let folderCollection: {
    createIndex: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    insertOne: jest.Mock;
    updateOne: jest.Mock;
    bulkWrite: jest.Mock;
    deleteOne: jest.Mock;
  };

  beforeEach(() => {
    folders = [];
    placements = [];

    const assertUnique = (candidate: TomeFolder, exceptId?: string) => {
      const duplicate = folders.find((existing) =>
        existing.id !== exceptId &&
        existing.project_id === candidate.project_id &&
        (
          existing.id === candidate.id ||
          (typeof candidate.source_path === "string" && existing.source_path === candidate.source_path) ||
          (
            typeof candidate.display_name_key === "string" &&
            existing.parent_id === candidate.parent_id &&
            existing.display_name_key === candidate.display_name_key
          )
        ),
      );
      if (duplicate) throw duplicateKeyError();
    };

    folderCollection = {
      createIndex: jest.fn().mockResolvedValue("index"),
      find: jest.fn((filter: Record<string, unknown>) => {
        const cursor = {
          sort: jest.fn((sort: Record<string, 1 | -1>) => {
            const entries = Object.entries(sort);
            result.sort((left, right) => {
              for (const [key, direction] of entries) {
                const comparison = String(left[key as keyof TomeFolder] ?? "")
                  .localeCompare(String(right[key as keyof TomeFolder] ?? ""));
                if (comparison !== 0) return comparison * direction;
              }
              return 0;
            });
            return cursor;
          }),
          toArray: jest.fn(async () => result.map((item) => ({ ...item }))),
        };
        const result = folders.filter((item) => matches(
          item as unknown as Record<string, unknown>,
          filter,
        ));
        return cursor;
      }),
      findOne: jest.fn(async (filter: Record<string, unknown>) =>
        folders.find((item) => matches(item as unknown as Record<string, unknown>, filter)) ?? null),
      insertOne: jest.fn(async (document: TomeFolder) => {
        assertUnique(document);
        folders.push({ ...document });
        return { acknowledged: true };
      }),
      updateOne: jest.fn(async (
        filter: Record<string, unknown>,
        update: { $set?: Partial<TomeFolder>; $setOnInsert?: TomeFolder },
        options?: { upsert?: boolean },
      ) => {
        const index = folders.findIndex((item) => matches(
          item as unknown as Record<string, unknown>,
          filter,
        ));
        if (index >= 0 && update.$set) {
          const candidate = { ...folders[index], ...update.$set };
          assertUnique(candidate, folders[index].id);
          folders[index] = candidate;
        } else if (index < 0 && options?.upsert && update.$setOnInsert) {
          assertUnique(update.$setOnInsert);
          folders.push({ ...update.$setOnInsert });
        }
        return { acknowledged: true };
      }),
      bulkWrite: jest.fn(async (operations: Array<{
        updateOne: { filter: Record<string, unknown>; update: { $set: Partial<TomeFolder> } };
      }>) => {
        for (const operation of operations) {
          const index = folders.findIndex((item) => matches(
            item as unknown as Record<string, unknown>,
            operation.updateOne.filter,
          ));
          if (index >= 0) folders[index] = { ...folders[index], ...operation.updateOne.update.$set };
        }
        return { acknowledged: true };
      }),
      deleteOne: jest.fn(async (filter: Record<string, unknown>) => {
        const index = folders.findIndex((item) => matches(
          item as unknown as Record<string, unknown>,
          filter,
        ));
        if (index >= 0) folders.splice(index, 1);
        return { acknowledged: true };
      }),
    };

    mockGetFolders.mockResolvedValue(folderCollection);
    mockGetPlacements.mockResolvedValue({
      findOne: jest.fn(async (filter: Record<string, unknown>) =>
        placements.find((item) => matches(item, filter)) ?? null),
    });
  });

  it("creates exact case, space, hyphen, and underscore variants as distinct siblings", async () => {
    for (const name of [
      "IOC EXPERIMENTS",
      "ioc experiments",
      "ioc-experiments",
      "ioc_experiments",
    ]) {
      await createFolder({
        projectId: "project-primary",
        parentId: null,
        name,
        actor: "test-user@example.com",
      });
    }

    expect(folders.map(({ name, display_name_key: displayNameKey }) => [name, displayNameKey]))
      .toEqual([
        ["IOC EXPERIMENTS", "IOC EXPERIMENTS"],
        ["ioc experiments", "ioc experiments"],
        ["ioc-experiments", "ioc-experiments"],
        ["ioc_experiments", "ioc_experiments"],
      ]);
    await expect(createFolder({
      projectId: "project-primary",
      parentId: null,
      name: "ioc-experiments",
      actor: "test-user@example.com",
    })).rejects.toMatchObject({ code: "DUPLICATE_FOLDER_NAME", status: 409 });
  });

  it("trims names, accepts the 120-character boundary, and appends sibling order", async () => {
    folders.push(folder({ id: "folder-existing", name: "Existing", order: 8 }));
    const created = await createFolder({
      projectId: "project-primary",
      parentId: null,
      name: `  ${"x".repeat(120)}  `,
      actor: "test-user@example.com",
    });

    expect(created.name).toHaveLength(120);
    expect(created.order).toBe(9);
    expect(created).toMatchObject({
      source_path: null,
      display_name_key: "x".repeat(120),
      folder_schema_version: 2,
    });
  });

  it("rejects a missing parent without inserting a folder", async () => {
    await expect(createFolder({
      projectId: "project-primary",
      parentId: "folder-missing",
      name: "Planning",
      actor: "test-user@example.com",
    })).rejects.toMatchObject({ code: "FOLDER_PARENT_NOT_FOUND", status: 404 });
    expect(folders).toEqual([]);
  });

  it("renames and moves a source folder without changing its identity or source path", async () => {
    folders.push(
      folder({ id: "folder-source", name: "docs", source_path: "docs", order: 1 }),
      folder({ id: "folder-parent", name: "Parent", order: 0 }),
      folder({ id: "folder-sibling", name: "Sibling", parent_id: "folder-parent", order: 4 }),
    );

    const updated = await updateFolder({
      projectId: "project-primary",
      folderId: "folder-source",
      actor: "editor@example.com",
      name: "DOCS_archive",
      parentId: "folder-parent",
    });

    expect(updated).toMatchObject({
      id: "folder-source",
      source_path: "docs",
      name: "DOCS_archive",
      name_key: "docs_archive",
      display_name_key: "DOCS_archive",
      parent_id: "folder-parent",
      order: 5,
      updated_by: "editor@example.com",
    });
  });

  it("rejects duplicate renames, missing parents, cycles, and invalid orders", async () => {
    folders.push(
      folder({ id: "folder-parent", name: "Parent" }),
      folder({ id: "folder-child", name: "Child", parent_id: "folder-parent" }),
      folder({ id: "folder-peer", name: "Peer" }),
    );

    await expect(updateFolder({
      projectId: "project-primary",
      folderId: "folder-peer",
      actor: "test-user@example.com",
      name: "Parent",
    })).rejects.toMatchObject({ code: "DUPLICATE_FOLDER_NAME", status: 409 });
    await expect(updateFolder({
      projectId: "project-primary",
      folderId: "folder-peer",
      actor: "test-user@example.com",
      parentId: "folder-missing",
    })).rejects.toMatchObject({ code: "FOLDER_PARENT_NOT_FOUND", status: 404 });
    await expect(updateFolder({
      projectId: "project-primary",
      folderId: "folder-parent",
      actor: "test-user@example.com",
      parentId: "folder-child",
    })).rejects.toMatchObject({ code: "FOLDER_MOVE_CYCLE", status: 409 });
    for (const order of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      await expect(updateFolder({
        projectId: "project-primary",
        folderId: "folder-peer",
        actor: "test-user@example.com",
        order,
      })).rejects.toMatchObject({ code: "INVALID_FOLDER_ORDER", status: 400 });
    }
  });

  it("reorders deterministically and treats movement beyond a boundary as a no-op", async () => {
    folders.push(
      folder({ id: "folder-alpha", name: "Alpha", order: 0 }),
      folder({ id: "folder-bravo", name: "Bravo", order: 1 }),
      folder({ id: "folder-charlie", name: "Charlie", order: 2 }),
    );

    await reorderFolder({
      projectId: "project-primary",
      folderId: "folder-bravo",
      actor: "test-user@example.com",
      direction: "down",
    });
    expect(folders.map((item) => [item.id, item.order])).toEqual([
      ["folder-alpha", 0],
      ["folder-bravo", 2],
      ["folder-charlie", 1],
    ]);

    folderCollection.bulkWrite.mockClear();
    await reorderFolder({
      projectId: "project-primary",
      folderId: "folder-alpha",
      actor: "test-user@example.com",
      direction: "up",
    });
    expect(folderCollection.bulkWrite).not.toHaveBeenCalled();
  });

  it("blocks deletion for child folders, source pages, and manually placed pages", async () => {
    folders.push(
      folder({ id: "folder-parent", name: "Parent" }),
      folder({ id: "folder-child", name: "Child", parent_id: "folder-parent" }),
      folder({ id: "folder-source", name: "docs", source_path: "docs" }),
      folder({ id: "folder-manual", name: "Manual" }),
    );
    placements.push({
      project_id: "project-primary",
      path: "unrelated.md",
      folder_id: "folder-manual",
    });

    await expect(deleteFolder("project-primary", "folder-parent", []))
      .rejects.toMatchObject({ code: "FOLDER_NOT_EMPTY", status: 409 });
    await expect(deleteFolder("project-primary", "folder-source", ["docs/start.md"]))
      .rejects.toMatchObject({ code: "FOLDER_NOT_EMPTY", status: 409 });
    await expect(deleteFolder("project-primary", "folder-manual", ["unrelated.md"]))
      .rejects.toMatchObject({ code: "FOLDER_NOT_EMPTY", status: 409 });
  });

  it("deletes an empty folder and rejects an unknown folder", async () => {
    folders.push(folder({ id: "folder-empty", name: "Empty" }));
    await expect(deleteFolder("project-primary", "folder-empty", []))
      .resolves.toMatchObject({ id: "folder-empty" });
    expect(folders).toEqual([]);
    await expect(deleteFolder("project-primary", "folder-missing", []))
      .rejects.toMatchObject({ code: "FOLDER_NOT_FOUND", status: 404 });
  });
});
