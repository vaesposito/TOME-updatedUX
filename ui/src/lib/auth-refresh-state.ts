import { createHash } from 'node:crypto';
import { getCollection, isMongoDBConfigured } from './mongodb';

type RefreshFailure = { outcome: 'terminal' | 'transient'; expiresAt: Date };
type RefreshFailureDoc = RefreshFailure & { _id: string };
const COLLECTION = 'auth_refresh_failures';
const MAX_LOCAL_ENTRIES = 10_000;
const failures = new Map<string, RefreshFailure>();
let indexReady: Promise<unknown> | undefined;

// Never retain credentials in keys or persist them in failure records. Scope
// the fingerprint to the provider/client as tokens need not be globally unique.
export function refreshFingerprint(issuer: string, clientId: string, token: string): string {
  return createHash('sha256').update(JSON.stringify([issuer, clientId, token])).digest('hex');
}

function remember(key: string, failure: RefreshFailure): void {
  for (const [id, entry] of failures) {
    if (entry.expiresAt.getTime() <= Date.now()) failures.delete(id);
  }
  failures.delete(key);
  if (failures.size >= MAX_LOCAL_ENTRIES) failures.delete(failures.keys().next().value!);
  failures.set(key, failure);
}

export async function getRefreshFailure(key: string): Promise<RefreshFailure | undefined> {
  const local = failures.get(key);
  if (local && local.expiresAt.getTime() > Date.now()) return local;
  failures.delete(key);
  if (!isMongoDBConfigured) return undefined;
  try {
    const col = await getCollection<RefreshFailureDoc>(COLLECTION);
    // TTL cleanup is asynchronous; the query must enforce expiry itself.
    const failure = await col.findOne({ _id: key, expiresAt: { $gt: new Date() } });
    if (failure) {
      remember(key, failure);
      return failure;
    }
  } catch {
    console.warn('[Auth] Shared refresh failure lookup unavailable; using local protection');
  }
  return undefined;
}

export async function recordRefreshFailure(key: string, outcome: RefreshFailure['outcome']): Promise<void> {
  // Terminal records cover the UI's 24h session lifetime. Transient records
  // enforce backoff even when a read-only server request cannot update cookies.
  const failure = { outcome, expiresAt: new Date(Date.now() + (outcome === 'terminal' ? 86_400_000 : 60_000)) };
  const local = failures.get(key);
  if (local?.outcome === 'terminal' && local.expiresAt.getTime() > Date.now()) return;
  remember(key, failure);
  if (!isMongoDBConfigured) return;
  try {
    const col = await getCollection<RefreshFailureDoc>(COLLECTION);
    indexReady ??= col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {
      indexReady = undefined;
      throw new Error('refresh failure TTL index unavailable');
    });
    await indexReady;
    // A concurrent transport failure must not downgrade a terminal rejection.
    if (outcome === 'transient') {
      await col.updateOne({ _id: key }, { $setOnInsert: failure }, { upsert: true });
      // Renew an expired record even if the TTL monitor has not removed it yet.
      await col.updateOne({ _id: key, expiresAt: { $lte: new Date() } }, { $set: failure });
    } else {
      await col.updateOne({ _id: key }, { $set: failure }, { upsert: true });
    }
  } catch {
    console.warn('[Auth] Shared refresh failure persistence unavailable; using local protection');
  }
}

/** Reset only the process-local cache (tests). */
export function resetRefreshFailures(): void {
  failures.clear();
  indexReady = undefined;
}
