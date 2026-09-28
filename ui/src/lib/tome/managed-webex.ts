import { ApiError } from "@/lib/api-error";
import { webexSpaceProvider } from "./webex-space-provider";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import type { ProviderConnectionMetadata } from "@/lib/credentials/oauth-service";
import type { ResourceAuthzSession } from "@/lib/rbac/resource-authz";
import { resolveUserIdentitiesByEmail } from "@/lib/rbac/user-identity-directory";
import type {
  ProjectDocument,
  WebexCredentialMode,
  WebexRoomSource,
} from "@/types/projects";
import {
  getManagedWebexConfig,
  type ManagedWebexConfig,
} from "./managed-webex-config";

const HEALTH_CACHE_MS = Math.max(
  5_000,
  Number(process.env.TOME_MANAGED_WEBEX_MESSAGING_HEALTH_CACHE_MS) || 30_000,
);

export interface ManagedWebexCapability {
  enabled: boolean;
  configured: boolean;
  available: boolean;
  provider: string;
  displayName: string;
  accountEmail?: string;
  reason?: string;
}

interface ManagedWebexCredentialResult {
  capability: ManagedWebexCapability;
  accessToken?: string;
  connection?: ProviderConnectionMetadata;
}

interface WebexProfile {
  id?: string;
  orgId?: string;
  displayName?: string;
  emails?: string[];
}

interface WebexMembership {
  roomId?: string;
}

let cachedCredential:
  | { cacheKey: string; checkedAt: number; result: ManagedWebexCredentialResult }
  | undefined;

export { getManagedWebexConfig, isProtectedManagedWebexConnection } from "./managed-webex-config";

function configCacheKey(config: ManagedWebexConfig): string {
  return JSON.stringify(config);
}

function isConfigured(config: ManagedWebexConfig): boolean {
  return Boolean(config.provider && config.accountEmail);
}

function unavailable(
  config: ManagedWebexConfig,
  reason: string,
): ManagedWebexCredentialResult {
  return {
    capability: {
      enabled: config.enabled,
      configured: isConfigured(config),
      available: false,
      provider: config.provider,
      displayName: "Managed Webex account",
      ...(config.accountEmail ? { accountEmail: config.accountEmail } : {}),
      reason,
    },
  };
}

function profileMatches(profile: WebexProfile, config: ManagedWebexConfig): boolean {
  const emails = (profile.emails ?? []).map((email) => email.trim().toLowerCase());
  return emails.includes(config.accountEmail);
}

/**
 * Resolve and identity-check the one deployment-designated Webex Messaging
 * connection. Tokens never leave this server-only module.
 */
export async function resolveManagedWebexCredential(options?: {
  force?: boolean;
  fetchImpl?: typeof fetch;
  /** Discovery/attachment editing needs membership scope; ingestion does not. */
  requireMemberships?: boolean;
}): Promise<ManagedWebexCredentialResult> {
  const config = getManagedWebexConfig();
  if (!config.enabled) return unavailable(config, "Managed Webex is disabled.");
  if (!isConfigured(config)) {
    return unavailable(config, "Managed Webex identity is not fully configured.");
  }

  const cacheKey = `${configCacheKey(config)}:${options?.requireMemberships !== false}`;
  const now = Date.now();
  if (
    !options?.force &&
    cachedCredential?.cacheKey === cacheKey &&
    now - cachedCredential.checkedAt < HEALTH_CACHE_MS
  ) {
    return cachedCredential.result;
  }

  let result: ManagedWebexCredentialResult;
  try {
    const identities = await resolveUserIdentitiesByEmail([config.accountEmail]);
    const managedOwner = identities.get(config.accountEmail);
    if (!managedOwner) {
      result = unavailable(
        config,
        "Managed Webex account has not signed in to CAIPE.",
      );
      cachedCredential = { cacheKey, checkedAt: now, result };
      return result;
    }
    const service = await getProviderConnectionService();
    const connections = await service.listConnections(
      { type: "user", id: managedOwner.subject },
      { includeDisabled: true },
    );
    const connection = connections.find(
      (candidate) =>
        candidate.provider === config.provider && candidate.status === "connected",
    );
    if (!connection) {
      result = unavailable(config, "Managed Webex account needs reconnection.");
    } else if (
      options?.requireMemberships !== false && connection.grantedScopes?.length &&
      !connection.grantedScopes.includes("spark:memberships_read")
    ) {
      result = unavailable(
        config,
        "Managed Webex cannot verify shared spaces. Contact an administrator.",
      );
    } else {
      const refreshed = await service.refreshConnection(connection.id);
      const profileResponse = await (options?.fetchImpl ?? fetch)(
        "https://webexapis.com/v1/people/me",
        {
          headers: {
            Authorization: `Bearer ${refreshed.accessToken}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!profileResponse.ok) {
        result = unavailable(
          config,
          `Managed Webex identity check failed (HTTP ${profileResponse.status}).`,
        );
      } else {
        const profile = (await profileResponse.json()) as WebexProfile;
        if (!profileMatches(profile, config)) {
          result = unavailable(
            config,
            "Managed Webex identity does not match deployment configuration.",
          );
        } else {
          result = {
            capability: {
              enabled: true,
              configured: true,
              available: true,
              provider: config.provider,
              displayName: "Managed Webex account",
              accountEmail: config.accountEmail,
            },
            accessToken: refreshed.accessToken,
            connection,
          };
        }
      }
    }
  } catch {
    result = unavailable(config, "Managed Webex account needs reconnection.");
  }

  cachedCredential = { cacheKey, checkedAt: now, result };
  return result;
}

export async function getManagedWebexCapability(): Promise<ManagedWebexCapability> {
  return (await resolveManagedWebexCredential()).capability;
}

export function clearManagedWebexHealthCache(): void {
  cachedCredential = undefined;
}

export function projectWebexCredentialMode(
  project: Pick<ProjectDocument, "sources">,
): WebexCredentialMode {
  return project.sources?.webex_credential_mode === "managed"
    ? "managed"
    : "personal";
}

export function projectWebexCredentialProvider(
  project: Pick<ProjectDocument, "sources">,
): string {
  if (projectWebexCredentialMode(project) === "managed") {
    return getManagedWebexConfig().provider;
  }
  return project.sources?.webex_credential_provider?.trim() || "webex";
}

export function normalizeWebexCredentialSettings(input: {
  mode?: unknown;
  provider?: unknown;
}): { mode: WebexCredentialMode; provider: string } {
  const mode = input.mode === undefined ? "personal" : input.mode;
  if (mode !== "personal" && mode !== "managed") {
    throw new ApiError(
      "Webex credential mode must be personal or managed.",
      400,
      "INVALID_WEBEX_CREDENTIAL_MODE",
    );
  }
  if (mode === "managed") {
    return { mode, provider: getManagedWebexConfig().provider };
  }
  const provider =
    typeof input.provider === "string" && input.provider.trim()
      ? input.provider.trim()
      : "webex";
  if (provider !== "webex" && provider !== "webex_messaging" && provider !== webexSpaceProvider()) {
    throw new ApiError(
      "Unsupported personal Webex credential provider.",
      400,
      "INVALID_WEBEX_CREDENTIAL_PROVIDER",
    );
  }
  return { mode, provider };
}

/**
 * List rooms visible to the managed account where the named human is also a
 * live Webex member. Webex requires roomId when a normal user token filters
 * memberships by personEmail, so each candidate room is checked explicitly.
 */
export async function listManagedWebexSharedRoomIds(input: {
  accessToken: string;
  userEmail: string;
  roomIds: readonly string[];
  fetchImpl?: typeof fetch;
}): Promise<Set<string>> {
  const userEmail = input.userEmail.trim().toLowerCase();
  if (!userEmail) {
    throw new ApiError(
      "Your Webex identity could not be verified. Contact an administrator.",
      400,
      "WEBEX_USER_EMAIL_REQUIRED",
    );
  }

  const candidates = Array.from(
    new Set(input.roomIds.map((roomId) => roomId.trim()).filter(Boolean)),
  );
  const sharedRoomIds = new Set<string>();
  const fetchImpl = input.fetchImpl ?? fetch;
  const batchSize = 8;

  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize);
    const results = await Promise.all(
      batch.map(async (roomId) => {
        const url = new URL("https://webexapis.com/v1/memberships");
        url.searchParams.set("roomId", roomId);
        url.searchParams.set("personEmail", userEmail);
        url.searchParams.set("max", "1");
        const response = await fetchImpl(url.href, {
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            Accept: "application/json",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          console.warn(
            `[ManagedWebex] membership verification failed (HTTP ${response.status})`,
          );
          throw new ApiError(
            "Managed Webex cannot verify shared spaces. Contact an administrator.",
            502,
            "MANAGED_WEBEX_MEMBERSHIP_LOOKUP_FAILED",
          );
        }
        const body = (await response.json().catch(() => ({}))) as {
          items?: WebexMembership[];
        };
        return (body.items ?? []).some(
          (membership) => membership.roomId?.trim() === roomId,
        );
      }),
    );
    results.forEach((isShared, index) => {
      if (isShared) sharedRoomIds.add(batch[index]);
    });
  }
  return sharedRoomIds;
}

export async function assertManagedWebexUserSharesRooms(input: {
  accessToken: string;
  userEmail: string;
  rooms: WebexRoomSource[];
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (input.rooms.length === 0) return;
  const sharedRoomIds = await listManagedWebexSharedRoomIds({
    accessToken: input.accessToken,
    userEmail: input.userEmail,
    roomIds: input.rooms.map((room) => room.room_id),
    fetchImpl: input.fetchImpl,
  });
  const notShared = input.rooms.filter((room) => !sharedRoomIds.has(room.room_id));
  if (notShared.length > 0) {
    throw new ApiError(
      `You and the managed Webex account must both belong to these spaces: ${notShared
        .map((room) => room.name || room.room_id)
        .join(", ")}.`,
      403,
      "MANAGED_WEBEX_SHARED_MEMBERSHIP_REQUIRED",
    );
  }
}

export async function assertManagedWebexRoomsAccessible(input: {
  session: ResourceAuthzSession;
  userEmail?: string;
  rooms: WebexRoomSource[];
}): Promise<void> {
  const resolved = await resolveManagedWebexCredential({ force: true });
  if (!resolved.capability.available || !resolved.accessToken) {
    throw new ApiError(
      resolved.capability.reason || "Managed Webex account is unavailable.",
      409,
      "MANAGED_WEBEX_UNAVAILABLE",
    );
  }

  await assertManagedWebexUserSharesRooms({
    accessToken: resolved.accessToken,
    userEmail: input.userEmail ?? input.session.user?.email ?? "",
    rooms: input.rooms,
  });

  const checks = await Promise.all(
    input.rooms.map(async (room) => {
      try {
        const response = await fetch(
          `https://webexapis.com/v1/rooms/${encodeURIComponent(room.room_id)}`,
          {
            headers: {
              Authorization: `Bearer ${resolved.accessToken}`,
              Accept: "application/json",
            },
          },
        );
        return response.ok;
      } catch {
        return false;
      }
    }),
  );
  const inaccessible = input.rooms.filter((_, index) => !checks[index]);
  if (inaccessible.length > 0) {
    throw new ApiError(
      `Add the managed Webex account to these spaces before selecting them: ${inaccessible
        .map((room) => room.name || room.room_id)
        .join(", ")}.`,
      409,
      "MANAGED_WEBEX_ROOM_INACCESSIBLE",
    );
  }
}
