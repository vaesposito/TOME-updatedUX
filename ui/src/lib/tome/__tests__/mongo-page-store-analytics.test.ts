const mockInsertMany = jest.fn();

jest.mock("mongodb", () => ({
  ObjectId: class ObjectId {
    static isValid() { return false; }
  },
}));

jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomePageRevisionsCollection: jest.fn().mockImplementation(async () => ({
    insertMany: (...args: unknown[]) => mockInsertMany(...args),
  })),
}));

import { MongoPageStore } from "@/lib/tome/mongo-page-store";

describe("MongoPageStore analytics attribution", () => {
  beforeEach(() => jest.clearAllMocks());

  it("persists origin and template binding metadata with a revision", async () => {
    const store = new MongoPageStore();
    await store.writePage(
      "project-1",
      "architecture.md",
      "---\ntemplate_scope: top-level\ntemplate_path: architecture.md\ntemplate_version: 3\n---\n# Architecture",
      { author: "editor@example.test", message: "edit architecture.md", origin: "manual" },
    );

    expect(mockInsertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        project_id: "project-1",
        path: "architecture.md",
        origin: "manual",
        template_scope: "top-level",
        template_path: "architecture.md",
        template_version: 3,
      }),
    ]);
  });
});
