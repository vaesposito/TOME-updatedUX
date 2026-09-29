import type { WebexCredentialMode, WebexRoomRunAs } from "@/types/projects";

/** Display the actual account used for this caller; added-by is not an execution identity. */
export function WebexRoomRunsAs({ runAs, mode }: {
  runAs?: WebexRoomRunAs;
  mode: WebexCredentialMode;
}) {
  const label = runAs
    ? `${runAs.name}${runAs.email && runAs.email !== runAs.name ? ` (${runAs.email})` : ""}`
    : mode === "managed" ? "Managed Webex account" : "Your Webex connection";
  return <span className="break-words text-xs text-muted-foreground">
    Runs as: {label}{mode === "managed" ? " · managed account" : ""}
  </span>;
}
