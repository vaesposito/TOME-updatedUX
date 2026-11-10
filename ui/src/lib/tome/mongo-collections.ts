/**
 * Typed wrappers around getCollection() for Tome's index/metadata collections.
 * Server-only; do not import from a client component.
 *
 * NB: there is no projects collection here — Tome reuses CAIPE's existing
 * `projects` collection (see @/types/projects). These collections hold only
 * wiki-specific data, all keyed by `project_id`.
 */

import type { Collection } from "mongodb";
import { getCollection } from "@/lib/mongodb";
import {
  TOME_COLLECTIONS,
  type PageRevision,
  type Report,
  type IngestRun,
  type ChatSession,
  type ChatMessage,
  type ChatRun,
  type TomeUsageEvent,
  type EdgeIndexRow,
  type SpaceTagIndexRow,
  type TrackedEntityIndexRow,
  type Gist,
  type TomeFolder,
  type TomePagePlacement,
} from "@/types/tome";

export interface TomePageWriteLock {
  _id: string;
  owner_token: string;
  expires_at: Date;
}

export async function getTomePageRevisionsCollection(): Promise<
  Collection<PageRevision>
> {
  return getCollection<PageRevision>(TOME_COLLECTIONS.PAGE_REVISIONS);
}

export async function getTomePageWriteLocksCollection(): Promise<
  Collection<TomePageWriteLock>
> {
  return getCollection<TomePageWriteLock>("tome_page_write_locks");
}

export async function getTomeReportsCollection(): Promise<Collection<Report>> {
  return getCollection<Report>(TOME_COLLECTIONS.REPORTS);
}

export async function getTomeIngestRunsCollection(): Promise<
  Collection<IngestRun>
> {
  return getCollection<IngestRun>(TOME_COLLECTIONS.INGEST_RUNS);
}

export async function getTomeChatSessionsCollection(): Promise<
  Collection<ChatSession>
> {
  return getCollection<ChatSession>(TOME_COLLECTIONS.CHAT_SESSIONS);
}

export async function getTomeChatMessagesCollection(): Promise<
  Collection<ChatMessage>
> {
  return getCollection<ChatMessage>(TOME_COLLECTIONS.CHAT_MESSAGES);
}

export async function getTomeChatRunsCollection(): Promise<
  Collection<ChatRun>
> {
  return getCollection<ChatRun>(TOME_COLLECTIONS.CHAT_RUNS);
}

export async function getTomeUsageEventsCollection(): Promise<
  Collection<TomeUsageEvent>
> {
  return getCollection<TomeUsageEvent>(TOME_COLLECTIONS.USAGE_EVENTS);
}

export async function getTomeEdgesIndexCollection(): Promise<
  Collection<EdgeIndexRow>
> {
  return getCollection<EdgeIndexRow>(TOME_COLLECTIONS.EDGES_INDEX);
}

export async function getTomeTrackedEntitiesIndexCollection(): Promise<
  Collection<TrackedEntityIndexRow>
> {
  return getCollection<TrackedEntityIndexRow>(TOME_COLLECTIONS.TRACKED_ENTITIES_INDEX);
}

export async function getTomeSpaceTagsIndexCollection(): Promise<
  Collection<SpaceTagIndexRow>
> {
  return getCollection<SpaceTagIndexRow>(TOME_COLLECTIONS.SPACE_TAGS_INDEX);
}

export async function getTomeGistsCollection(): Promise<Collection<Gist>> {
  return getCollection<Gist>(TOME_COLLECTIONS.GISTS);
}

export async function getTomeFoldersCollection(): Promise<Collection<TomeFolder>> {
  return getCollection<TomeFolder>(TOME_COLLECTIONS.FOLDERS);
}

export async function getTomePagePlacementsCollection(): Promise<Collection<TomePagePlacement>> {
  return getCollection<TomePagePlacement>(TOME_COLLECTIONS.PAGE_PLACEMENTS);
}
