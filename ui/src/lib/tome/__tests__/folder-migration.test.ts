import {
  TOME_FOLDER_MIGRATION_ACTOR,
  planTomeFolderMigration,
  type FolderMigrationDocument,
} from "@/lib/tome/folder-migration";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function folder(input: Partial<FolderMigrationDocument> & {
  id: string;
  name: string;
}): FolderMigrationDocument {
  return {
    id: input.id,
    project_id: "project-primary",
    parent_id: null,
    name: input.name,
    name_key: input.name.toLocaleLowerCase(),
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

describe("Tome folder schema migration", () => {
  it("restores exact source names and materializes normalized-path collisions", () => {
    const plan = planTomeFolderMigration({
      folders: [folder({
        id: "folder-existing",
        name: "Ioc Experiments",
        name_key: "ioc experiments",
        source_path: "ioc_experiments",
      })],
      livePagePaths: [
        { project_id: "project-primary", path: "ioc_experiments/overview.md" },
        { project_id: "project-primary", path: "ioc-experiments/results.md" },
      ],
      now: NOW,
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.updates).toEqual([expect.objectContaining({
      id: "folder-existing",
      set: expect.objectContaining({
        name: "ioc_experiments",
        name_key: "ioc_experiments",
        display_name_key: "ioc_experiments",
        folder_schema_version: 2,
        updated_by: TOME_FOLDER_MIGRATION_ACTOR,
      }),
    })]);
    expect(plan.inserts).toEqual([expect.objectContaining({
      name: "ioc-experiments",
      name_key: "ioc-experiments",
      display_name_key: "ioc-experiments",
      source_path: "ioc-experiments",
      folder_schema_version: 2,
    })]);
  });

  it("preserves every exact case, space, hyphen, and underscore source variant", () => {
    const paths = [
      "IOC EXPERIMENTS/page.md",
      "ioc experiments/page.md",
      "ioc-experiments/page.md",
      "ioc_experiments/page.md",
    ];
    const plan = planTomeFolderMigration({
      folders: [],
      livePagePaths: paths.map((path) => ({ project_id: "project-primary", path })),
      now: NOW,
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.inserts.map((item) => [item.name, item.source_path])).toEqual([
      ["ioc experiments", "ioc experiments"],
      ["IOC EXPERIMENTS", "IOC EXPERIMENTS"],
      ["ioc_experiments", "ioc_experiments"],
      ["ioc-experiments", "ioc-experiments"],
    ]);
    expect(new Set(plan.inserts.map((item) => item.id)).size).toBe(4);
  });

  it("materializes nested source paths with deterministic parent identities", () => {
    const input = {
      folders: [],
      livePagePaths: [{
        project_id: "project-primary",
        path: "Parent_One/Child-Two/UPPER THREE/page.md",
      }],
      now: NOW,
    };
    const first = planTomeFolderMigration(input);
    const second = planTomeFolderMigration(input);

    expect(first.conflicts).toEqual([]);
    expect(first.inserts.map((item) => ({
      id: item.id,
      parent_id: item.parent_id,
      source_path: item.source_path,
    }))).toEqual([
      expect.objectContaining({ parent_id: null, source_path: "Parent_One" }),
      expect.objectContaining({
        parent_id: first.inserts[0].id,
        source_path: "Parent_One/Child-Two",
      }),
      expect.objectContaining({
        parent_id: first.inserts[1].id,
        source_path: "Parent_One/Child-Two/UPPER THREE",
      }),
    ]);
    expect(second.inserts.map((item) => item.id)).toEqual(first.inserts.map((item) => item.id));
  });

  it("preserves explicit display-name edits on source folders", () => {
    const plan = planTomeFolderMigration({
      folders: [folder({
        id: "folder-renamed",
        name: "Experiment Archive",
        name_key: "experiment archive",
        source_path: "ioc-experiments",
      })],
      livePagePaths: [],
      now: NOW,
    });

    expect(plan.updates[0].set).not.toHaveProperty("name");
    expect(plan.updates[0].set).toMatchObject({
      display_name_key: "Experiment Archive",
      folder_schema_version: 2,
    });
  });

  it("adopts an exact manual folder instead of changing its stable id", () => {
    const plan = planTomeFolderMigration({
      folders: [folder({ id: "folder-manual", name: "docs" })],
      livePagePaths: [{ project_id: "project-primary", path: "docs/start.md" }],
      now: NOW,
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.inserts).toEqual([]);
    expect(plan.updates[0]).toMatchObject({
      id: "folder-manual",
      set: { source_path: "docs", display_name_key: "docs" },
    });
  });

  it("backfills a stable id only when a legacy record is missing one", () => {
    const plan = planTomeFolderMigration({
      folders: [{
        _id: "mongo-folder-1",
        project_id: "project-primary",
        parent_id: null,
        name: "Planning",
        name_key: "planning",
        source_path: null,
      }],
      livePagePaths: [],
      now: NOW,
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.updates[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^folder-[a-f0-9]{24}$/),
      set: expect.objectContaining({ id: expect.stringMatching(/^folder-[a-f0-9]{24}$/) }),
      reasons: expect.arrayContaining(["backfill_stable_id"]),
    }));
  });

  it("reports exact sibling conflicts instead of producing a partial plan", () => {
    const plan = planTomeFolderMigration({
      folders: [
        folder({ id: "folder-one", name: "docs", name_key: "legacy-one" }),
        folder({ id: "folder-two", name: "docs", name_key: "legacy-two" }),
      ],
      livePagePaths: [],
      now: NOW,
    });

    expect(plan.conflicts).toEqual([expect.objectContaining({
      kind: "duplicate_display_name",
      folder_ids: ["folder-one", "folder-two"],
    })]);
  });

  it("allows exact display names to repeat in different parents or projects", () => {
    const plan = planTomeFolderMigration({
      folders: [
        folder({ id: "folder-parent-one", name: "One" }),
        folder({ id: "folder-parent-two", name: "Two" }),
        folder({ id: "folder-child-one", name: "docs", parent_id: "folder-parent-one" }),
        folder({ id: "folder-child-two", name: "docs", parent_id: "folder-parent-two" }),
        folder({ id: "folder-other-project", name: "docs", project_id: "project-secondary" }),
      ],
      livePagePaths: [],
      now: NOW,
    });

    expect(plan.conflicts).toEqual([]);
  });

  it("reports duplicate stable ids and exact source paths", () => {
    const plan = planTomeFolderMigration({
      folders: [
        folder({ id: "folder-duplicate", name: "One", source_path: "one" }),
        folder({ id: "folder-duplicate", name: "Two", source_path: "two" }),
        folder({ id: "folder-three", name: "Three", source_path: "shared" }),
        folder({ id: "folder-four", name: "Four", source_path: "shared" }),
      ],
      livePagePaths: [],
      now: NOW,
    });

    expect(plan.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "duplicate_id" }),
      expect.objectContaining({ kind: "duplicate_source_path" }),
    ]));
  });

  it("reports invalid legacy rows without planning updates for them", () => {
    const plan = planTomeFolderMigration({
      folders: [
        { id: "folder-no-project", project_id: "", parent_id: null, name: "No project", source_path: null },
        { id: "folder-no-name", project_id: "project-primary", parent_id: null, name: "", source_path: null },
        { id: "folder-bad-parent", project_id: "project-primary", parent_id: 42, name: "Bad", source_path: null },
        { id: "folder-bad-source", project_id: "project-primary", parent_id: null, name: "Bad", source_path: 42 },
      ],
      livePagePaths: [],
      now: NOW,
    });

    expect(plan.conflicts).toHaveLength(4);
    expect(plan.conflicts.every((conflict) => conflict.kind === "invalid_folder")).toBe(true);
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([]);
  });

  it("detects a generated source-folder id collision with an existing manual folder", () => {
    const livePagePaths = [{ project_id: "project-primary", path: "docs/start.md" }];
    const generated = planTomeFolderMigration({ folders: [], livePagePaths, now: NOW }).inserts[0];
    const plan = planTomeFolderMigration({
      folders: [folder({ id: generated.id, name: "Manual" })],
      livePagePaths,
      now: NOW,
    });

    expect(plan.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "duplicate_id", folder_ids: [generated.id, generated.id] }),
    ]));
  });

  it("is a no-op after all rows and source paths are migrated", () => {
    const migrated = folder({
      id: "folder-docs",
      name: "docs",
      name_key: "docs",
      display_name_key: "docs",
      folder_schema_version: 2,
      source_path: "docs",
    });
    const plan = planTomeFolderMigration({
      folders: [migrated],
      livePagePaths: [{ project_id: "project-primary", path: "docs/start.md" }],
      now: NOW,
    });

    expect(plan).toMatchObject({ updates: [], inserts: [], conflicts: [] });
  });
});
