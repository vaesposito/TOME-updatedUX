import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ProjectSources, WebexRoomSource } from "@/types/projects";
import { SourcesEditor } from "../SourcesEditor";

const mockChange = jest.fn();
const originalFetch = global.fetch;
const addedBy = { subject: "user-a", name: "User A", email: "a@example.com", added_at: "2026-01-01T00:00:00Z" };
const personal: WebexRoomSource = { room_id: "personal", name: "Personal room", slug: "personal",
  credential_mode: "personal", credential_provider: "webex", added_by: addedBy };
const managed: WebexRoomSource = { room_id: "managed", name: "Managed room", slug: "managed",
  credential_mode: "managed", credential_provider: "webex_messaging", added_by: addedBy };
let denied: string[];
let failAccess: boolean;

function Editor({ rooms = [personal, managed] }: { rooms?: WebexRoomSource[] }) {
  const [value, setValue] = useState<ProjectSources>({ webex_rooms: rooms });
  return <SourcesEditor settingsProjectSlug="example" kinds={["webex"]} value={value} onChange={(next) => { mockChange(next); setValue(next); }} />;
}
async function click(element: HTMLElement) { await act(async () => { fireEvent.click(element); }); }

beforeEach(() => {
  mockChange.mockReset(); denied = []; failAccess = false;
  global.fetch = jest.fn(async (url) => {
    if (String(url).includes("webex-room-access")) {
      if (failAccess) throw new Error("timeout");
      return { ok: true, json: async () => ({ data: { rooms: [personal, managed, { ...personal, room_id: "legacy" }].map((room) => ({
        room_id: room.room_id, name: room.name, mode: room.credential_mode, available: !denied.includes(room.room_id),
        access: denied.includes(room.room_id) ? "inaccessible" : "accessible",
        run_as: { mode: room.credential_mode, name: room.credential_mode === "managed" ? "Generic Account" : "Current User" },
      })) } }) } as Response;
    }
    return { ok: true, json: async () => ({ data: {
      connected: true, options: [{ value: "personal", label: "Personal room" }, { value: "managed", label: "Managed room" }, { value: "new", label: "New room" }],
      managedCapability: { available: true, provider: "webex_messaging", accountEmail: "generic@example.com" },
    } }) } as Response;
  });
});
afterEach(() => { global.fetch = originalFetch; });

it("places selected and add sections in one branded Webex source card, in that order", async () => {
  render(<Editor />);
  const card = screen.getByRole("region", { name: "Webex source" });
  await within(card).findByText(/Runs as: Current User/);
  expect(within(card).getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
    "Webex source", "Selected Webex Spaces", "Add a new Webex Space",
  ]);
  expect(within(card).getByRole("region", { name: "Selected Webex Spaces" })).toBeInTheDocument();
  expect(within(card).getByRole("region", { name: "Add a new Webex Space" })).toBeInTheDocument();
  expect(card.querySelectorAll('img[src="/provider-logos/webex.svg"]')).toHaveLength(1);
  expect(within(card).queryByText("Webex", { exact: true })).not.toBeInTheDocument();
  expect(within(card).getByTitle("Refresh")).toBeInTheDocument();
});

it("keeps saved rooms fixed and excludes them from BOTH discovery tabs without saving", async () => {
  render(<Editor />);
  const selected = screen.getByRole("region", { name: "Selected Webex Spaces" });
  const add = screen.getByRole("region", { name: "Add a new Webex Space" });
  await screen.findByText(/Runs as: Current User/);
  for (const tab of [/Managed Webex account/, /My Webex connection/]) {
    await click(await within(add).findByRole("button", { name: tab }));
    await within(add).findByRole("button", { name: "New room" });
    expect(within(selected).getByText("Personal room")).toBeInTheDocument();
    expect(within(selected).getByText("Managed room")).toBeInTheDocument();
    expect(within(selected).getByText(/Runs as: Current User/)).toBeInTheDocument();
    expect(within(selected).getByText(/Runs as: Generic Account/)).toBeInTheDocument();
    expect(within(add).queryByRole("button", { name: "Personal room" })).not.toBeInTheDocument();
    expect(within(add).queryByRole("button", { name: "Managed room" })).not.toBeInTheDocument();
  }
  expect(mockChange).not.toHaveBeenCalled();
  expect(within(selected).queryByText(/User A/)).not.toBeInTheDocument();
  expect(screen.queryByText("Rooms added by other users")).not.toBeInTheDocument();
});

it.each(["personal", "managed"] as const)("adds a %s space without modifying retained source metadata", async (mode) => {
  render(<Editor />);
  if (mode === "managed") await click(await screen.findByRole("button", { name: /Managed Webex account/ }));
  await click(await screen.findByRole("button", { name: "New room" }));
  expect(mockChange).toHaveBeenLastCalledWith({ webex_rooms: [personal, managed, {
    room_id: "new", name: "New room", slug: "new-room", credential_mode: mode,
    credential_provider: mode === "managed" ? "webex_messaging" : "webex",
  }] });
  expect(screen.queryByRole("button", { name: "New room" })).not.toBeInTheDocument();
});

it("allows removal of an accessible space and makes it selectable again", async () => {
  render(<Editor />);
  await screen.findByText(/Runs as: Generic Account/);
  await click(screen.getByRole("button", { name: "Remove Managed room" }));
  expect(mockChange).toHaveBeenLastCalledWith({ webex_rooms: [personal] });
  expect(await screen.findByRole("button", { name: "Managed room" })).toBeInTheDocument();
});

it.each(["personal", "managed"])("shows the adder only in the no-access warning and disables %s removal", async (id) => {
  denied = [id]; render(<Editor />);
  expect(await screen.findByText("User A added it and you don't have access to delete.")).toBeInTheDocument();
  const name = id === "managed" ? "Managed room" : "Personal room";
  expect(screen.getByRole("button", { name: `Remove ${name}` })).toBeDisabled();
  await click(screen.getByRole("button", { name: `Remove ${name}` }));
  expect(mockChange).not.toHaveBeenCalled();
});

it("never invents an adder or requires account assignment for legacy rooms", async () => {
  denied = ["legacy"];
  render(<Editor rooms={[{ room_id: "legacy", name: "Legacy room", slug: "legacy" }]} />);
  expect(await screen.findByText("The original adder was not recorded and you don't have access to delete.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Choose account" })).not.toBeInTheDocument();
  expect(mockChange).not.toHaveBeenCalled();
});

it("refreshes removal permissions using the existing refresh button", async () => {
  denied = ["managed"]; render(<Editor />);
  await screen.findByText(/User A added it/);
  denied = [];
  await click(screen.getByTitle("Refresh"));
  await screen.findByText(/Runs as: Generic Account/);
  expect(screen.getByRole("button", { name: "Remove Managed room" })).toBeEnabled();
});

it("keeps removal disabled on lookup failure without falsely claiming missing membership", async () => {
  failAccess = true; render(<Editor />);
  await screen.findAllByText(/Access could not be verified/);
  expect(screen.getByRole("button", { name: "Remove Managed room" })).toBeDisabled();
  expect(screen.queryByText(/User A added it/)).not.toBeInTheDocument();
});
