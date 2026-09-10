import { ApiError } from "@/lib/api-error";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import type { ProviderConnectionMetadata } from "@/lib/credentials/oauth-service";
import { getReadableWebexSpaceIds } from "@/lib/rbac/user-insights-scope";
import { subjectFromSession, type ResourceAuthzSession } from "@/lib/rbac/resource-authz";
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
}): Promise<ManagedWebexCredentialResult> {
  const config = getManagedWebexConfig();
  if (!config.enabled) return unavailable(config, "Managed Webex is disabled.");
  if (!isConfigured(config)) {
    return unavailable(config, "Managed Webex identity is not fully configured.");
  }

  const cacheKey = configCacheKey(config);
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
    } else {
      const refreshed = await service.refreshConnection(connection.id);
      const profileResponse = await (options?.fetchImpl ?? fetch)(
        "https://webexapis.com/v1/people/me",
        {
          headers: {
            Authorization: `Bearer ${refreshed.accessToken}`,
            Accept: "application/json",
          },
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
  if (provider !== "webex" && provider !== "webex_messaging") {
    throw new ApiError(
      "Unsupported personal Webex credential provider.",
      400,
      "INVALID_WEBEX_CREDENTIAL_PROVIDER",
    );
  }
  return { mode, provider };
}

export async function assertManagedWebexRoomsAccessible(input: {
  session: ResourceAuthzSession;
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

  const openfgaSubject = subjectFromSession(input.session);
  const readable = new Set(
    openfgaSubject ? await getReadableWebexSpaceIds(openfgaSubject) : [],
  );
  const unauthorized = input.rooms.filter((room) => !readable.has(room.room_id));
  if (unauthorized.length > 0) {
    throw new ApiError(
      `You are not authorized to attach these Webex spaces: ${unauthorized
        .map((room) => room.name || room.room_id)
        .join(", ")}.`,
      403,
      "WEBEX_SPACE_ACCESS_REQUIRED",
    );
  }

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
