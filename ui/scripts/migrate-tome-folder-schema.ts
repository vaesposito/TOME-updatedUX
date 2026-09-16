/**
 * Versioned Tome folder-schema migration.
 *
 * Rollout order:
 *   1. Deploy compatibility code that reads legacy rows and dual-writes
 *      name_key + display_name_key.
 *   2. Run this script without --apply and resolve every reported conflict.
 *   3. Run with --apply after all legacy UI writers have been replaced.
 *   4. Remove legacy name_key writes in a later release.
 *
 * Usage from ui/:
 *   npm run migrate:tome-folders
 *   npm run migrate:tome-folders -- --project project-id
 *   npm run migrate:tome-folders -- --apply
 */

import { randomUUID } from "crypto";
import { MongoClient, type Db, type Document } from "mongodb";

import {
  TOME_FOLDER_MIGRATION_ACTOR,
  TOME_FOLDER_MIGRATION_ID,
  planTomeFolderMigration,
  type FolderMigrationDocument,
  type FolderMigrationPlan,
  type LivePagePath,
} from "../src/lib/tome/folder-migration";

const FOLDERS_COLLECTION = "tome_folders";
const REVISIONS_COLLECTION = "tome_page_revisions";
const MIGRATIONS_COLLECTION = "tome_schema_migrations";
const LOCK_TTL_MS = 15 * 60 * 1000;
const DISPLAY_NAME_INDEX = "tome_folder_sibling_display_name_unique_v2";

interface MigrationArgs {
  apply: boolean;
  projectId?: string;
}

interface MigrationRecord extends Document {
  _id: string;
  owner_token?: string;
}

function migrationCollection(db: Db) {
  return db.collection<MigrationRecord>(MIGRATIONS_COLLECTION);
}

function parseArgs(argv: readonly string[]): MigrationArgs {
  const apply = argv.includes("--apply") || process.env.APPLY === "true";
  const projectIndex = argv.indexOf("--project");
  const projectId = projectIndex >= 0 ? argv[projectIndex + 1] : undefined;
  if (projectIndex >= 0 && !projectId) {
    throw new Error("--project requires a project id");
  }
  return { apply, projectId };
}

async function loadLivePagePaths(db: Db, projectId?: string): Promise<LivePagePath[]> {
  const filter: Record<string, unknown> = {
    status: { $nin: ["draft", "rejected"] },
    ...(projectId ? { project_id: projectId } : {}),
  };
  const revisions = await db.collection(REVISIONS_COLLECTION)
    .find(filter, { projection: { project_id: 1, path: 1, deleted: 1, created_at: 1 } })
    .sort({ project_id: 1, path: 1, created_at: -1, _id: -1 })
    .toArray();
  const seen = new Set<string>();
  const live: LivePagePath[] = [];
  for (const revision of revisions) {
    if (typeof revision.project_id !== "string" || typeof revision.path !== "string") continue;
    const key = `${revision.project_id}\0${revision.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!revision.deleted) live.push({ project_id: revision.project_id, path: revision.path });
  }
  return live;
}

function isLegacyNameIndex(index: Document): boolean {
  const key = index.key as Record<string, unknown> | undefined;
  return Boolean(
    index.unique &&
    key?.project_id === 1 &&
    key?.parent_id === 1 &&
    key?.name_key === 1 &&
    Object.keys(key).length === 3,
  );
}

async function acquireMigrationLock(db: Db, ownerToken: string, now: Date): Promise<void> {
  const migrations = migrationCollection(db);
  try {
    const lock = await migrations.findOneAndUpdate(
      {
        _id: TOME_FOLDER_MIGRATION_ID,
        $or: [
          { status: { $ne: "running" } },
          { lease_expires_at: { $lte: now } },
          { owner_token: ownerToken },
        ],
      },
      {
        $set: {
          area: "tome",
          version: 2,
          status: "running",
          owner_token: ownerToken,
          started_at: now,
          lease_expires_at: new Date(now.getTime() + LOCK_TTL_MS),
          actor: TOME_FOLDER_MIGRATION_ACTOR,
        },
        $setOnInsert: { created_at: now },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (lock?.owner_token !== ownerToken) throw new Error("migration lock was not acquired");
  } catch (error: unknown) {
    if ((error as { code?: number }).code === 11000) {
      throw new Error(`Migration ${TOME_FOLDER_MIGRATION_ID} is already running`);
    }
    throw error;
  }
}

async function applyPlan(db: Db, plan: FolderMigrationPlan, ownerToken: string): Promise<void> {
  if (plan.conflicts.length > 0) {
    throw new Error(`Refusing to apply migration with ${plan.conflicts.length} conflict(s)`);
  }

  const folders = db.collection(FOLDERS_COLLECTION);
  await folders.createIndex({ project_id: 1, id: 1 }, { unique: true });
  await folders.createIndex(
    { project_id: 1, source_path: 1 },
    { unique: true, partialFilterExpression: { source_path: { $type: "string" } } },
  );
  if (plan.updates.length > 0) {
    await folders.bulkWrite(plan.updates.map((update) => ({
      updateOne: {
        filter: update.mongo_id === undefined
          ? { project_id: update.project_id, id: update.id }
          : { _id: update.mongo_id },
        update: { $set: update.set },
      },
    })));
  }

  await folders.createIndex(
    { project_id: 1, parent_id: 1, display_name_key: 1 },
    {
      name: DISPLAY_NAME_INDEX,
      unique: true,
      partialFilterExpression: { display_name_key: { $type: "string" } },
    },
  );

  const indexes = await folders.indexes();
  for (const index of indexes) {
    if (isLegacyNameIndex(index) && typeof index.name === "string") {
      await folders.dropIndex(index.name);
    }
  }

  if (plan.inserts.length > 0) {
    await folders.bulkWrite(plan.inserts.map((folder) => ({
      updateOne: {
        filter: { project_id: folder.project_id, source_path: folder.source_path },
        update: { $setOnInsert: folder },
        upsert: true,
      },
    })));
  }

  const completedAt = new Date();
  await migrationCollection(db).updateOne(
    { _id: TOME_FOLDER_MIGRATION_ID, owner_token: ownerToken },
    {
      $set: {
        status: "completed",
        completed_at: completedAt,
        lease_expires_at: completedAt,
        summary: {
          folders_scanned: plan.foldersScanned,
          live_pages_scanned: plan.livePagesScanned,
          folders_updated: plan.updates.length,
          folders_inserted: plan.inserts.length,
        },
      },
    },
  );
}

async function markFailed(db: Db, ownerToken: string, error: unknown): Promise<void> {
  await migrationCollection(db).updateOne(
    { _id: TOME_FOLDER_MIGRATION_ID, owner_token: ownerToken },
    {
      $set: {
        status: "failed",
        failed_at: new Date(),
        error: error instanceof Error ? error.message : String(error),
      },
    },
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply && args.projectId) {
    throw new Error("--project is available for dry-run audits only; --apply performs the global index cutover");
  }
  const mongoUri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DATABASE;
  if (!mongoUri || !databaseName) {
    throw new Error("MONGODB_URI and MONGODB_DATABASE are required");
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    const db = client.db(databaseName);
    const folderFilter = args.projectId ? { project_id: args.projectId } : {};
    const [folders, livePagePaths] = await Promise.all([
      db.collection<FolderMigrationDocument>(FOLDERS_COLLECTION).find(folderFilter).toArray(),
      loadLivePagePaths(db, args.projectId),
    ]);
    const plan = planTomeFolderMigration({ folders, livePagePaths, now: new Date() });
    console.log(JSON.stringify({
      migration: TOME_FOLDER_MIGRATION_ID,
      apply: args.apply,
      project_id: args.projectId ?? null,
      summary: {
        folders_scanned: plan.foldersScanned,
        live_pages_scanned: plan.livePagesScanned,
        folders_to_update: plan.updates.length,
        folders_to_insert: plan.inserts.length,
        conflicts: plan.conflicts.length,
      },
      conflicts: plan.conflicts,
    }, null, 2));

    if (!args.apply) {
      console.log("[dry-run] no writes performed. Re-run with --apply after replacing legacy UI writers.");
      return;
    }

    const ownerToken = randomUUID();
    await acquireMigrationLock(db, ownerToken, new Date());
    try {
      await applyPlan(db, plan, ownerToken);
      console.log(JSON.stringify({ migration: TOME_FOLDER_MIGRATION_ID, status: "completed" }, null, 2));
    } catch (error) {
      await markFailed(db, ownerToken, error);
      throw error;
    }
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { isLegacyNameIndex, parseArgs };
