/** Server-only: personal rooms use the caller/schedule owner; managed rooms use the generic account. */
import { ApiError } from "@/lib/api-error";
import { webexRoomAccount } from "@/lib/projects/webex-room-account";
import { personalWebexSpaceToken, webexSpaceConnectionLabel, webexSpaceProvider } from "./webex-space-provider";
import type { ProjectSources, WebexRoomCheck, WebexRoomRunAs, WebexRoomSource } from "@/types/projects";
import {
  listManagedWebexSharedRoomIds,
  normalizeWebexCredentialSettings,
  resolveManagedWebexCredential,
} from "./managed-webex";

type AccountSettings = ReturnType<typeof webexRoomAccount>;
type Account = { token: string; runAs: WebexRoomRunAs };
type Caller = { subject: string; userEmail?: string | null };
type Forwarded = Record<string, Record<string, string>>;

async function webexGet(path: string, token: string): Promise<Response> {
  return fetch(`https://webexapis.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
}

async function accountFor(settings: AccountSettings, caller: Caller, purpose: "ingest" | "edit" | "add", forwarded?: Forwarded): Promise<Account> {
  let token = "";
  let email: string | undefined;
  if (settings.mode === "managed") {
    const managed = await resolveManagedWebexCredential({ force: true, requireMemberships: purpose !== "ingest" });
    if (!managed.capability.available || !managed.accessToken) {
      throw new Error("Managed Webex account is unavailable. Contact an administrator.");
    }
    token = managed.accessToken;
    email = managed.capability.accountEmail;
  } else if (caller.subject) {
    const credential = await personalWebexSpaceToken(caller.subject, purpose !== "add", forwarded);
    token = credential?.accessToken ?? "";
  }
  if (!token) throw new Error("Webex connection is not available.");
  const fallback: WebexRoomRunAs = { mode: settings.mode,
    name: settings.mode === "managed" ? "Managed Webex account" : "Your Webex connection",
    ...(email ? { email } : {}) };
  try {
    const response = await webexGet("people/me", token);
    if (response.ok) {
      const profile = await response.json() as { displayName?: string; emails?: string[] };
      email = profile.emails?.[0] || email;
      return { token, runAs: { mode: settings.mode, name: profile.displayName || email || fallback.name, ...(email ? { email } : {}) } };
    }
  } catch {
    // A display-name lookup must not change room permissions.
  }
  return { token, runAs: fallback };
}

/** Access checks cover ingestion, removal and new attachments. Managed caller
 * membership is checked ONLY for editing/adding; personal access always uses the caller.
 * New attachments require the configured app; existing-space checks permit legacy fallback.
 * Never return roomTokens to a browser.
 */
export async function resolveWebexRoomExecution(input: Caller & {
  sources: ProjectSources;
  purpose: "ingest" | "edit" | "add";
  forwarded?: Forwarded;
}): Promise<{ checks: WebexRoomCheck[]; roomTokens: Record<string, string> }> {
  const accounts = new Map<string, Promise<Account>>();
  const roomTokens: Record<string, string> = Object.create(null);
  const rooms = input.sources.webex_rooms ?? [];
  const checks: WebexRoomCheck[] = [];
  const personalConnection = rooms.some((room) => webexRoomAccount(room, input.sources).mode === "personal")
    ? await webexSpaceConnectionLabel() : undefined;
  for (let offset = 0; offset < rooms.length; offset += 8) {
    checks.push(...await Promise.all(rooms.slice(offset, offset + 8).map(async (room): Promise<WebexRoomCheck> => {
      const settings = webexRoomAccount(room, input.sources);
      const check: WebexRoomCheck = { room_id: room.room_id, name: room.name, mode: settings.mode, available: false, access: "unknown" };
      const key = settings.mode;
      let pending = accounts.get(key);
      if (!pending) {
        pending = accountFor(settings, input, input.purpose, input.forwarded);
        accounts.set(key, pending);
      }
      let account: Account;
      try {
        account = await pending;
      } catch {
        return { ...check, no_token: true, connection: settings.mode === "personal" ? personalConnection : undefined, detail: settings.mode === "managed"
          ? "Managed Webex account is unavailable. Contact an administrator."
          : `Connect ${personalConnection?.name ?? "Webex"} to access this space.` };
      }
      check.run_as = account.runAs;
      // Personal ingestion retains its existing behavior: a failed room read is
      // a tool error, not a reason to switch to the adder's credentials.
      if (settings.mode === "personal" && input.purpose === "ingest") roomTokens[room.room_id] = account.token;
      try {
        const response = await webexGet(`rooms/${encodeURIComponent(room.room_id)}`, account.token);
        if (!response.ok) return { ...check,
          access: response.status === 403 || response.status === 404 ? "inaccessible" : "unknown",
          detail: settings.mode === "managed" ? "The managed Webex account cannot access this space." : `No access to ${room.name || room.room_id}` };
        if (input.purpose !== "ingest" && settings.mode === "managed") {
          const shared = await listManagedWebexSharedRoomIds({ accessToken: account.token,
            userEmail: input.userEmail ?? "", roomIds: [room.room_id] });
          if (!shared.has(room.room_id)) return { ...check, access: "inaccessible", detail: "You are not a member of this space." };
        }
        roomTokens[room.room_id] = account.token;
        return { ...check, available: true, access: "accessible" };
      } catch {
        return { ...check, detail: "Could not verify Webex space access. Refresh and try again." };
      }
    })));
  }
  return { checks, roomTokens };
}

/** Called after project edit authorization. Preserve existing attribution and
 * account mode; verify only additions/removals. Never infer legacy adders.
 */
export async function prepareWebexRooms(input: Caller & {
  rooms: WebexRoomSource[];
  previousSources?: ProjectSources;
  userName?: string | null;
  defaults: AccountSettings;
}): Promise<WebexRoomSource[]> {
  const previous = new Map((input.previousSources?.webex_rooms ?? []).map((room) => [room.room_id, room]));
  const selected = new Map(input.rooms.map((room) => [room.room_id, room]));
  const removed = [...previous.values()].filter((room) => !selected.has(room.room_id));
  if (removed.length) {
    const { checks } = await resolveWebexRoomExecution({ ...input, purpose: "edit",
      sources: { ...input.previousSources, webex_rooms: removed } });
    const blocked = checks.filter((room) => !room.available);
    if (blocked.length) throw new ApiError(`You do not have access to remove these Webex spaces: ${blocked.map((room) => room.name).join(", ")}.`,
      403, "WEBEX_ROOM_REMOVE_FORBIDDEN");
  }
  const newRooms = [...selected.values()].filter((room) => !previous.has(room.room_id)).map((room) => {
    const settings = normalizeWebexCredentialSettings({
      mode: room.credential_mode ?? input.defaults.mode,
      provider: room.credential_provider ?? input.defaults.provider,
    });
    return { room_id: room.room_id, name: room.name, slug: room.slug,
      credential_mode: settings.mode, credential_provider: settings.mode === "personal" ? webexSpaceProvider() : settings.provider };
  });
  if (newRooms.length) {
    if (!input.subject) throw new ApiError("A signed-in user is required to add Webex spaces.", 403, "WEBEX_ADDER_REQUIRED");
    const { checks } = await resolveWebexRoomExecution({ ...input, purpose: "add", sources: { webex_rooms: newRooms } });
    const blocked = checks.filter((room) => !room.available);
    if (blocked.length) throw new ApiError(`You cannot add these Webex spaces: ${blocked.map((room) => room.name).join(", ")}. Check your connection and space membership.`,
      403, "WEBEX_ROOM_ADD_FORBIDDEN");
  }
  const addedBy = { subject: input.subject, name: input.userName || input.userEmail || "User",
    email: input.userEmail ?? "", added_at: new Date().toISOString() };
  const added = new Map(newRooms.map((room) => [room.room_id, { ...room, added_by: addedBy }]));
  // Metadata received from the browser cannot overwrite saved mode or attribution.
  return [...selected.keys()].map((id) => previous.get(id) ?? added.get(id)!);
}
