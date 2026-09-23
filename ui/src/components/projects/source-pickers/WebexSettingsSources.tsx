"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { toWebexRoomSource, webexRoomToPickerValue } from "@/lib/projects/webex-room";
import type { ProjectSources, WebexCredentialMode, WebexRoomSource } from "@/types/projects";
import { SourcePicker } from "./index";
import { WebexCredentialModePicker } from "./WebexCredentialModePicker";

type RoomAccess = "accessible" | "inaccessible" | "unknown";
interface AccessResult {
  mode: WebexCredentialMode;
  provider: string;
  accountEmail?: string;
  rooms: Record<string, RoomAccess>;
}

/** Settings-only grouping; account browsing never changes saved sources. */
export function WebexSettingsSources({ slug, value, onChange }: {
  slug: string;
  value: ProjectSources;
  onChange: (next: ProjectSources) => void;
}) {
  const savedMode = value.webex_credential_mode === "managed" ? "managed" : "personal";
  const savedProvider = value.webex_credential_provider || (savedMode === "managed" ? "webex_messaging" : "webex");
  const [browse, setBrowse] = useState<{ mode: WebexCredentialMode; provider: string }>({
    mode: savedMode,
    provider: savedProvider,
  });
  const [access, setAccess] = useState<{ key: string; data: AccessResult } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [completedRequest, setCompletedRequest] = useState("");
  const [selectionError, setSelectionError] = useState("");
  // A freshly selected option already passed the current user's source lookup.
  // It may not be in the persisted project yet while autosave is pending.
  const [newlySelected, setNewlySelected] = useState(new Set<string>());
  const rooms = value.webex_rooms ?? [];
  const accessKey = JSON.stringify([slug, savedMode, savedProvider, rooms.map((room) => room.room_id).sort()]);
  const requestKey = JSON.stringify([accessKey, refresh]);
  const loading = completedRequest !== requestKey;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/tome/projects/${encodeURIComponent(slug)}/webex-room-access`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Access check failed");
        const body = await response.json();
        if (!body.data?.rooms) throw new Error("Access check failed");
        if (!controller.signal.aborted) setAccess({ key: accessKey, data: body.data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAccess(null);
      })
      .finally(() => { if (!controller.signal.aborted) setCompletedRequest(requestKey); });
    return () => controller.abort();
  }, [slug, accessKey, requestKey]);

  const result = access?.key === accessKey ? access.data : null;
  const status = (room: WebexRoomSource): RoomAccess =>
    result?.mode === savedMode && result.rooms[room.room_id]
      ? result.rooms[room.room_id]
      : newlySelected.has(room.room_id) ? "accessible" : "unknown";
  const accessible = rooms.filter((room) => status(room) === "accessible");
  const others = rooms.filter((room) => status(room) === "inaccessible");
  const unknown = rooms.filter((room) => status(room) === "unknown");
  const sameAccount = browse.mode === savedMode && browse.provider === savedProvider;
  const accountLabel = savedMode === "managed"
    ? `Managed Webex account${result?.accountEmail ? ` (${result.accountEmail})` : ""}`
    : "Personal Webex connection";

  function select(next: string[]) {
    // One project currently has one ingest credential. Do not silently switch
    // retained rooms to a different token while presenting this as browsing.
    if (!sameAccount && rooms.length) {
      setSelectionError(`Saved spaces use ${accountLabel}. Remove those saved spaces before adding spaces with a different account.`);
      return;
    }
    setSelectionError("");
    const selected = next.map((item) => {
      const decoded = toWebexRoomSource(item);
      return rooms.find((room) => room.room_id === decoded.room_id && room.name === decoded.name) ?? decoded;
    });
    setNewlySelected((previous) => new Set([...previous, ...selected.map((room) => room.room_id)]));
    const preserved = sameAccount ? [...others, ...unknown] : [];
    const merged = new Map([...preserved, ...selected].map((room) => [room.room_id, room]));
    onChange({
      ...value,
      webex_credential_mode: browse.mode,
      webex_credential_provider: browse.provider,
      webex_rooms: [...merged.values()],
    });
  }

  function savedRoomList(items: WebexRoomSource[], unverified = false) {
    return <ul className="divide-y divide-border/40">
      {items.map((room) => <li key={room.room_id} className="flex items-center justify-between gap-3 py-2">
        <div className="min-w-0">
          <p className="break-words text-sm">{room.name || room.room_id}</p>
          <p className="text-xs text-muted-foreground">
            {accountLabel} · {unverified ? "Access not verified" : "You do not have access"}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${room.name || room.room_id}`}
          onClick={() => onChange({ ...value, webex_rooms: rooms.filter((candidate) => candidate.room_id !== room.room_id) })}>
          Remove
        </Button>
      </li>)}
    </ul>;
  }

  return <div className="space-y-3">
    <WebexCredentialModePicker value={browse.mode} browsingOnly onChange={(mode, provider) => {
      setBrowse({ mode, provider: mode === savedMode ? savedProvider : provider });
      setSelectionError("");
    }} />
    <SourcePicker source="webex" selected={sameAccount ? accessible.map(webexRoomToPickerValue) : []}
      onChange={select} webexCredentialMode={browse.mode} webexCredentialProvider={browse.provider}
      onRefresh={() => { setNewlySelected(new Set()); setRefresh((version) => version + 1); }} />
    {!sameAccount && rooms.length > 0 ? <p className="text-xs text-muted-foreground">
      Saved spaces use {accountLabel}. Switch back to edit them. Browsing another account does not change their ingest account.
    </p> : null}
    {selectionError ? <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">{selectionError}</p> : null}
    <section aria-label="Rooms added by other users" className="rounded-lg border border-border p-4">
      <h4 className="text-sm font-medium">Rooms added by other users</h4>
      <p className="mt-1 text-xs text-muted-foreground">Saved project spaces you cannot access. This list stays the same when switching accounts.</p>
      {others.length ? savedRoomList(others) : <p className="mt-2 text-sm text-muted-foreground">
        {loading ? "Checking saved room access…" : "No inaccessible saved rooms."}
      </p>}
    </section>
    {unknown.length ? <section aria-label="Unverified saved rooms" className="rounded-lg border border-border p-4">
      <h4 className="text-sm font-medium">{loading ? "Checking saved room access…" : "Could not verify room access"}</h4>
      {!loading ? <p className="mt-1 text-xs text-muted-foreground">Use Refresh to check again. Saved rooms have not been removed. If this persists, contact an administrator.</p> : null}
      {savedRoomList(unknown, true)}
    </section> : null}
  </div>;
}
