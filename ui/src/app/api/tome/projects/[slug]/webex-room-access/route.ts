import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import { sessionSub } from "@/lib/tome/agent-proxy";
import { loadTomeProject } from "@/lib/tome/tome-api";
import {
  listManagedWebexSharedRoomIds,
  projectWebexCredentialMode,
  projectWebexCredentialProvider,
  resolveManagedWebexCredential,
} from "@/lib/tome/managed-webex";
import { getManagedWebexConfig } from "@/lib/tome/managed-webex-config";

export const dynamic = "force-dynamic";

// Check saved room IDs directly: absence from a paginated/search result does
// not establish lack of access. This endpoint never reads room messages.
export const GET = withErrorHandler(async (
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) => {
  const { slug } = await ctx.params;
  const { project, user, session } = await loadTomeProject(request, slug);
  const mode = projectWebexCredentialMode(project);
  const provider = projectWebexCredentialProvider(project);
  const roomIds = [...new Set((project.sources?.webex_rooms ?? []).map((room) => room.room_id))];
  const rooms: Record<string, "accessible" | "inaccessible" | "unknown"> =
    Object.fromEntries(roomIds.map((id) => [id, "unknown"]));
  const data = {
    mode,
    provider,
    accountEmail: mode === "managed" ? getManagedWebexConfig().accountEmail : undefined,
    rooms,
  };
  if (!roomIds.length) return successResponse(data);

  let token: string;
  try {
    if (mode === "managed") {
      const managed = await resolveManagedWebexCredential();
      if (!managed.capability.available || !managed.accessToken || !user.email) {
        return successResponse(data);
      }
      token = managed.accessToken;
    } else {
      const service = await getProviderConnectionService();
      const connection = (await service.listConnections({ type: "user", id: sessionSub(session) }))
        .find((candidate) => candidate.provider === provider && candidate.status === "connected");
      if (!connection) return successResponse(data);
      token = (await service.refreshConnection(connection.id)).accessToken;
    }
  } catch {
    return successResponse(data);
  }

  const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
  const boundedFetch: typeof fetch = (url, init) => fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.any([deadline, AbortSignal.timeout(5_000)]),
  });
  for (let offset = 0; offset < roomIds.length && !deadline.aborted; offset += 8) {
    await Promise.all(roomIds.slice(offset, offset + 8).map(async (roomId) => {
      try {
        if (mode === "managed") {
          const shared = await listManagedWebexSharedRoomIds({
            accessToken: token,
            userEmail: user.email!,
            roomIds: [roomId],
            fetchImpl: boundedFetch,
          });
          rooms[roomId] = shared.has(roomId) ? "accessible" : "inaccessible";
        } else {
          const response = await boundedFetch(
            `https://webexapis.com/v1/rooms/${encodeURIComponent(roomId)}`,
            { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
          );
          if (response.ok) rooms[roomId] = "accessible";
          else if (response.status === 403 || response.status === 404) rooms[roomId] = "inaccessible";
        }
      } catch {
        // An outage, expired credential or missing scope is not evidence that
        // the user is not a room member. Keep that room explicitly unknown.
      }
    }));
  }
  return successResponse(data);
});
