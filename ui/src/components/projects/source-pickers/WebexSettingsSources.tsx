"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ProviderLogo } from "@/components/credentials/provider-logo";
import { WebexRoomRunsAs } from "@/components/tome/WebexRoomRunsAs";
import { toWebexRoomSource } from "@/lib/projects/webex-room";
import { webexRoomAccount } from "@/lib/projects/webex-room-account";
import type { ProjectSources, WebexCredentialMode, WebexRoomCheck } from "@/types/projects";
import { SourcePicker } from "./index";
import { SOURCE_ADAPTERS } from "./adapters";
import { WebexCredentialModePicker } from "./WebexCredentialModePicker";

/** Discovery tabs never change saved attachments or their account types. */
export function WebexSettingsSources({ slug, value, onChange }: {
  slug: string;
  value: ProjectSources;
  onChange: (next: ProjectSources) => void;
}) {
  const [browse, setBrowse] = useState<{ mode: WebexCredentialMode; provider: string }>({
    mode: "personal", provider: "webex",
  });
  const [refresh, setRefresh] = useState(0);
  const [access, setAccess] = useState<{ key: string; rooms: WebexRoomCheck[] } | null>(null);
  const [completed, setCompleted] = useState("");
  const rooms = value.webex_rooms ?? [];
  const accessKey = JSON.stringify([slug, refresh, rooms.map((room) =>
    [room.room_id, webexRoomAccount(room, value), room.added_by?.added_at])]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/tome/projects/${encodeURIComponent(slug)}/webex-room-access`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Access check failed");
        const body = await response.json();
        if (!Array.isArray(body.data?.rooms)) throw new Error("Access check failed");
        if (!controller.signal.aborted) setAccess({ key: accessKey, rooms: body.data.rooms });
      })
      .catch(() => { if (!controller.signal.aborted) setAccess(null); })
      .finally(() => { if (!controller.signal.aborted) setCompleted(accessKey); });
    return () => controller.abort();
  }, [slug, accessKey]);

  return <section aria-label="Webex source" className="overflow-hidden rounded-2xl border border-border bg-card">
    <div className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-4 py-3">
      <span className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg ${SOURCE_ADAPTERS.webex.chipClass}`}>
        <ProviderLogo provider="webex" className="h-[15px] w-[15px] object-contain" />
      </span>
      <h3 className="text-sm font-semibold leading-tight">Webex source</h3>
    </div>
    <section aria-label="Selected Webex Spaces" className="px-4 py-4">
      <h4 className="text-sm font-medium">Selected Webex Spaces</h4>
      {!rooms.length ? <p className="mt-2 text-sm text-muted-foreground">No spaces selected.</p> :
        <ul className="divide-y divide-border/40">{rooms.map((room) => {
          const check = access?.key === accessKey ? access.rooms.find((item) => item.room_id === room.room_id) : undefined;
          const denied = check?.access === "inaccessible" || check?.no_token;
          const adder = room.added_by?.name || room.added_by?.email;
          return <li key={room.room_id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="break-words text-sm">{room.name || room.room_id}</p>
              <WebexRoomRunsAs runAs={check?.run_as} mode={webexRoomAccount(room, value).mode} />
              {denied ? <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                {adder ? `${adder} added it and you don't have access to delete.`
                  : "The original adder was not recorded and you don't have access to delete."}
              </p> : !check?.available ? <p className="mt-1 text-xs text-muted-foreground">
                {completed !== accessKey ? "Checking space access…" : "Access could not be verified. Refresh to check before removing this space."}
              </p> : null}
            </div>
            <Button type="button" variant="ghost" size="sm" disabled={!check?.available}
              aria-label={`Remove ${room.name || room.room_id}`}
              onClick={() => onChange({ ...value, webex_rooms: rooms.filter((candidate) => candidate.room_id !== room.room_id) })}>
              Remove
            </Button>
          </li>;
        })}</ul>}
    </section>
    <section aria-label="Add a new Webex Space" className="space-y-3 border-t border-border px-4 py-4">
      <h4 className="text-sm font-medium">Add a new Webex Space</h4>
      <WebexCredentialModePicker value={browse.mode} browsingOnly onChange={(mode, provider) => setBrowse({ mode, provider })} />
      <SourcePicker source="webex" embedded selected={[]} excludedKeys={rooms.map((room) => room.room_id)}
        webexCredentialMode={browse.mode} webexCredentialProvider={browse.provider}
        onRefresh={() => setRefresh((version) => version + 1)}
        onChange={(selected) => {
          const added = selected.map(toWebexRoomSource).filter((room) => !rooms.some((existing) => existing.room_id === room.room_id));
          if (added.length) onChange({ ...value, webex_rooms: [...rooms,
            ...added.map((room) => ({ ...room, credential_mode: browse.mode, credential_provider: browse.provider }))] });
        }} />
    </section>
  </section>;
}
