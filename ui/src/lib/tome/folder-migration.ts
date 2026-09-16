import { createHash } from "crypto";

export const TOME_FOLDER_MIGRATION_ID = "tome_folder_schema_v2";
export const TOME_FOLDER_SCHEMA_VERSION = 2 as const;
export const TOME_FOLDER_MIGRATION_ACTOR = `migration:${TOME_FOLDER_MIGRATION_ID}`;

export interface FolderMigrationDocument {
  _id?: unknown;
  id?: unknown;
  project_id?: unknown;
  parent_id?: unknown;
  name?: unknown;
  name_key?: unknown;
  display_name_key?: unknown;
  folder_schema_version?: unknown;
  source_path?: unknown;
  order?: unknown;
  owner_subject?: unknown;
  permission_scope?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  updated_by?: unknown;
}

export interface LivePagePath {
  project_id: string;
  path: string;
}

export interface FolderMigrationUpdate {
  project_id: string;
  id: string;
  mongo_id?: unknown;
  set: Record<string, unknown>;
  reasons: string[];
}

export interface FolderMigrationInsert {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  name_key: string;
  display_name_key: string;
  folder_schema_version: 2;
  source_path: string;
  order: number;
  owner_subject: string;
  permission_scope: "project";
  created_at: Date;
  updated_at: Date;
  updated_by: string;
}

export interface FolderMigrationConflict {
  kind: "invalid_folder" | "duplicate_id" | "duplicate_source_path" | "duplicate_display_name";
  project_id?: string;
  folder_ids: string[];
  detail: string;
}

export interface FolderMigrationPlan {
  foldersScanned: number;
  livePagesScanned: number;
  updates: FolderMigrationUpdate[];
  inserts: FolderMigrationInsert[];
  conflicts: FolderMigrationConflict[];
}

interface WorkingFolder {
  mongo_id?: unknown;
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  name_key: string;
  display_name_key: string;
  folder_schema_version: 2;
  source_path: string | null;
}

function exactNameKey(name: string): string {
  return name;
}

function legacyNameKey(name: string): string {
  return name.toLocaleLowerCase();
}

function sourceLeaf(sourcePath: string): string {
  return sourcePath.split("/").pop() ?? sourcePath;
}

export function legacyTitleFromPath(sourcePath: string): string {
  return sourceLeaf(sourcePath)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function inferredFolderId(projectId: string, sourcePath: string): string {
  return `folder-${createHash("sha256")
    .update(`${projectId}\0${sourcePath}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function recoveredFolderId(projectId: string, mongoId: unknown): string {
  return `folder-${createHash("sha256")
    .update(`${projectId}\0legacy\0${String(mongoId)}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function folderKey(projectId: string, id: string): string {
  return `${projectId}\0${id}`;
}

function sourceKey(projectId: string, sourcePath: string): string {
  return `${projectId}\0${sourcePath}`;
}

function siblingKey(projectId: string, parentId: string | null, name: string): string {
  return `${projectId}\0${parentId ?? "<root>"}\0${name}`;
}

function sourcePathsForPages(paths: readonly string[]): string[] {
  const sourcePaths = new Set<string>();
  for (const pagePath of paths) {
    const segments = pagePath.split("/").slice(0, -1);
    for (let depth = 1; depth <= segments.length; depth += 1) {
      sourcePaths.add(segments.slice(0, depth).join("/"));
    }
  }
  return [...sourcePaths].sort(
    (left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right),
  );
}

function validNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/** Build a deterministic, side-effect-free migration plan from Mongo snapshots. */
export function planTomeFolderMigration(input: {
  folders: readonly FolderMigrationDocument[];
  livePagePaths: readonly LivePagePath[];
  now: Date;
}): FolderMigrationPlan {
  const conflicts: FolderMigrationConflict[] = [];
  const updatesByFolder = new Map<string, FolderMigrationUpdate>();
  const working: WorkingFolder[] = [];

  const addUpdate = (
    folder: WorkingFolder,
    set: Record<string, unknown>,
    reasons: string[],
  ) => {
    const key = folderKey(folder.project_id, folder.id);
    const existing = updatesByFolder.get(key);
    updatesByFolder.set(key, {
      project_id: folder.project_id,
      id: folder.id,
      mongo_id: folder.mongo_id,
      set: { ...existing?.set, ...set },
      reasons: [...new Set([...(existing?.reasons ?? []), ...reasons])],
    });
  };

  for (const raw of input.folders) {
    if (
      typeof raw.project_id !== "string" || !raw.project_id ||
      typeof raw.name !== "string" || !raw.name ||
      !validNullableString(raw.parent_id) ||
      !validNullableString(raw.source_path)
    ) {
      conflicts.push({
        kind: "invalid_folder",
        project_id: typeof raw.project_id === "string" ? raw.project_id : undefined,
        folder_ids: typeof raw.id === "string" ? [raw.id] : [],
        detail: "Folder is missing a valid id, project_id, name, parent_id, or source_path.",
      });
      continue;
    }

    const migratedId = typeof raw.id === "string" && raw.id
      ? raw.id
      : raw.source_path
        ? inferredFolderId(raw.project_id, raw.source_path)
        : recoveredFolderId(raw.project_id, raw._id);
    const exactSourceName = raw.source_path ? sourceLeaf(raw.source_path) : null;
    const migratedName = raw.source_path && raw.name === legacyTitleFromPath(raw.source_path)
      ? exactSourceName!
      : raw.name;
    const desiredLegacyKey = legacyNameKey(migratedName);
    const desiredDisplayKey = exactNameKey(migratedName);
    const folder: WorkingFolder = {
      mongo_id: raw._id,
      id: migratedId,
      project_id: raw.project_id,
      parent_id: raw.parent_id,
      name: migratedName,
      name_key: desiredLegacyKey,
      display_name_key: desiredDisplayKey,
      folder_schema_version: TOME_FOLDER_SCHEMA_VERSION,
      source_path: raw.source_path,
    };
    working.push(folder);

    const set: Record<string, unknown> = {};
    const reasons: string[] = [];
    if (raw.id !== migratedId) {
      set.id = migratedId;
      reasons.push("backfill_stable_id");
    }
    if (raw.name !== migratedName) {
      set.name = migratedName;
      reasons.push("restore_exact_source_name");
    }
    if (raw.name_key !== desiredLegacyKey) {
      set.name_key = desiredLegacyKey;
      reasons.push("refresh_legacy_name_key");
    }
    if (raw.display_name_key !== desiredDisplayKey) {
      set.display_name_key = desiredDisplayKey;
      reasons.push("backfill_display_name_key");
    }
    if (raw.folder_schema_version !== TOME_FOLDER_SCHEMA_VERSION) {
      set.folder_schema_version = TOME_FOLDER_SCHEMA_VERSION;
      reasons.push("mark_schema_v2");
    }
    if (reasons.length > 0) {
      set.updated_at = input.now;
      set.updated_by = TOME_FOLDER_MIGRATION_ACTOR;
      addUpdate(folder, set, reasons);
    }
  }

  const bySource = new Map<string, WorkingFolder[]>();
  for (const folder of working) {
    if (folder.source_path) {
      const key = sourceKey(folder.project_id, folder.source_path);
      bySource.set(key, [...(bySource.get(key) ?? []), folder]);
    }
  }
  for (const duplicates of bySource.values()) {
    if (duplicates.length > 1) {
      conflicts.push({
        kind: "duplicate_source_path",
        project_id: duplicates[0].project_id,
        folder_ids: duplicates.map((folder) => folder.id),
        detail: `Source path ${duplicates[0].source_path} is represented by multiple folders.`,
      });
    }
  }

  const pagePathsByProject = new Map<string, string[]>();
  for (const page of input.livePagePaths) {
    pagePathsByProject.set(page.project_id, [
      ...(pagePathsByProject.get(page.project_id) ?? []),
      page.path,
    ]);
  }

  const inserts: FolderMigrationInsert[] = [];
  for (const [projectId, pagePaths] of pagePathsByProject) {
    const sourceFolderByPath = new Map(
      working
        .filter((folder) => folder.project_id === projectId && folder.source_path)
        .map((folder) => [folder.source_path!, folder]),
    );
    for (const sourcePath of sourcePathsForPages(pagePaths)) {
      if (sourceFolderByPath.has(sourcePath)) continue;
      const parentPath = sourcePath.includes("/")
        ? sourcePath.slice(0, sourcePath.lastIndexOf("/"))
        : null;
      const parentId = parentPath ? sourceFolderByPath.get(parentPath)?.id ?? null : null;
      const name = sourceLeaf(sourcePath);
      const reusable = working.find((folder) =>
        folder.project_id === projectId &&
        folder.parent_id === parentId &&
        folder.source_path === null &&
        folder.name === name,
      );
      if (reusable) {
        reusable.source_path = sourcePath;
        addUpdate(
          reusable,
          {
            source_path: sourcePath,
            name_key: legacyNameKey(name),
            display_name_key: exactNameKey(name),
            folder_schema_version: TOME_FOLDER_SCHEMA_VERSION,
            updated_at: input.now,
            updated_by: TOME_FOLDER_MIGRATION_ACTOR,
          },
          ["adopt_manual_folder_for_source_path"],
        );
        sourceFolderByPath.set(sourcePath, reusable);
        continue;
      }

      const inserted: FolderMigrationInsert = {
        id: inferredFolderId(projectId, sourcePath),
        project_id: projectId,
        parent_id: parentId,
        name,
        name_key: legacyNameKey(name),
        display_name_key: exactNameKey(name),
        folder_schema_version: TOME_FOLDER_SCHEMA_VERSION,
        source_path: sourcePath,
        order: 999,
        owner_subject: TOME_FOLDER_MIGRATION_ACTOR,
        permission_scope: "project",
        created_at: input.now,
        updated_at: input.now,
        updated_by: TOME_FOLDER_MIGRATION_ACTOR,
      };
      inserts.push(inserted);
      const workingInsert: WorkingFolder = { ...inserted };
      working.push(workingInsert);
      sourceFolderByPath.set(sourcePath, workingInsert);
    }
  }

  // Include materialized source folders in the ID check. A manually assigned
  // legacy ID could otherwise collide with a deterministic source-folder ID.
  const byId = new Map<string, WorkingFolder[]>();
  for (const folder of working) {
    const key = folderKey(folder.project_id, folder.id);
    byId.set(key, [...(byId.get(key) ?? []), folder]);
  }
  for (const duplicates of byId.values()) {
    if (duplicates.length > 1) {
      conflicts.push({
        kind: "duplicate_id",
        project_id: duplicates[0].project_id,
        folder_ids: duplicates.map((folder) => folder.id),
        detail: `Folder id ${duplicates[0].id} is not unique within the project.`,
      });
    }
  }

  const bySiblingName = new Map<string, WorkingFolder[]>();
  for (const folder of working) {
    const key = siblingKey(folder.project_id, folder.parent_id, folder.display_name_key);
    bySiblingName.set(key, [...(bySiblingName.get(key) ?? []), folder]);
  }
  for (const duplicates of bySiblingName.values()) {
    if (duplicates.length > 1) {
      conflicts.push({
        kind: "duplicate_display_name",
        project_id: duplicates[0].project_id,
        folder_ids: duplicates.map((folder) => folder.id),
        detail: `Sibling display name ${duplicates[0].display_name_key} is not unique.`,
      });
    }
  }

  return {
    foldersScanned: input.folders.length,
    livePagesScanned: input.livePagePaths.length,
    updates: [...updatesByFolder.values()],
    inserts,
    conflicts,
  };
}
