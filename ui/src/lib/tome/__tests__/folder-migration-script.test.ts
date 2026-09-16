jest.mock("mongodb", () => ({ MongoClient: jest.fn() }));

import {
  isLegacyNameIndex,
  parseArgs,
} from "../../../../scripts/migrate-tome-folder-schema";

describe("Tome folder migration CLI", () => {
  const originalApply = process.env.APPLY;

  afterEach(() => {
    if (originalApply === undefined) delete process.env.APPLY;
    else process.env.APPLY = originalApply;
  });

  it("defaults to a global dry-run", () => {
    delete process.env.APPLY;
    expect(parseArgs([])).toEqual({ apply: false, projectId: undefined });
  });

  it("supports explicit apply and project-scoped audit arguments", () => {
    expect(parseArgs(["--apply"])).toEqual({ apply: true, projectId: undefined });
    expect(parseArgs(["--project", "project-primary"])).toEqual({
      apply: false,
      projectId: "project-primary",
    });
  });

  it("supports the APPLY environment flag and rejects a missing project value", () => {
    process.env.APPLY = "true";
    expect(parseArgs([])).toEqual({ apply: true, projectId: undefined });
    expect(() => parseArgs(["--project"])).toThrow("--project requires a project id");
  });

  it("identifies only the exact legacy normalized-name unique index", () => {
    expect(isLegacyNameIndex({
      unique: true,
      key: { project_id: 1, parent_id: 1, name_key: 1 },
    })).toBe(true);
    expect(isLegacyNameIndex({
      unique: false,
      key: { project_id: 1, parent_id: 1, name_key: 1 },
    })).toBe(false);
    expect(isLegacyNameIndex({
      unique: true,
      key: { project_id: 1, parent_id: 1, name_key: 1, order: 1 },
    })).toBe(false);
    expect(isLegacyNameIndex({
      unique: true,
      key: { project_id: 1, parent_id: 1, display_name_key: 1 },
    })).toBe(false);
  });
});
