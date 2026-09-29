import type { ProjectSources, WebexCredentialMode, WebexRoomSource } from "@/types/projects";

/** Legacy room records use project-level configuration without rewriting them. */
export function webexRoomAccount(room: WebexRoomSource, sources?: ProjectSources): {
  mode: WebexCredentialMode; provider: string;
} {
  const mode = room.credential_mode ?? sources?.webex_credential_mode ?? "personal";
  const provider = room.credential_provider ||
    (!room.credential_mode ? sources?.webex_credential_provider : undefined) ||
    (mode === "managed" ? "webex_messaging" : "webex");
  return { mode, provider };
}
