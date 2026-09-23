import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { ProjectSources, WebexCredentialMode } from "@/types/projects";
import { SourcesEditor } from "../SourcesEditor";

const originalFetch = global.fetch;
const mockChange = jest.fn();
const available = { room_id: "available", name: "Accessible room", slug: "custom-slug" };
const other = { room_id: "other", name: "Other room", slug: "other-room" };
let statuses: Record<string, string>;
let savedMode: WebexCredentialMode;
let accessFails: boolean;

async function click(element: HTMLElement) {
  await act(async () => { fireEvent.click(element); });
}

function Editor({ mode = "managed", rooms = [available, other] }: {
  mode?: WebexCredentialMode;
  rooms?: typeof available[];
}) {
  const [value, setValue] = useState<ProjectSources>({
    repos: ["https://github.com/example/repo"],
    webex_credential_mode: mode,
    webex_credential_provider: mode === "managed" ? "webex_messaging" : "webex",
    webex_rooms: rooms,
  });
  return <SourcesEditor settingsProjectSlug="example" kinds={["webex"]} value={value} onChange={(next) => {
    mockChange(next);
    setValue(next);
  }} />;
}

describe("Settings Webex room access grouping", () => {
  beforeEach(() => {
    mockChange.mockReset();
    savedMode = "managed";
    accessFails = false;
    statuses = { available: "accessible", other: "inaccessible" };
    global.fetch = jest.fn(async (url) => {
      const access = String(url).includes("webex-room-access");
      return { ok: !access || !accessFails, json: async () => ({ data: access ? {
        mode: savedMode, provider: savedMode === "managed" ? "webex_messaging" : "webex",
        accountEmail: "managed@example.com", rooms: statuses,
      } : {
        connected: true,
        // Accessible saved rooms need not be in the first page of results.
        options: [{ value: "new", label: "New room" }],
        managedCapability: { available: true, provider: "webex_messaging", accountEmail: "managed@example.com" },
      } }) } as Response;
    });
  });
  afterEach(() => { global.fetch = originalFetch; });

  it.each(["personal", "managed"] as const)("keeps inaccessible %s rooms fixed across tab switches without saving", async (mode) => {
    savedMode = mode;
    render(<Editor mode={mode} />);
    const section = screen.getByRole("region", { name: "Rooms added by other users" });
    expect(await within(section).findByText("Other room")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accessible room" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Other room" })).not.toBeInTheDocument();
    if (mode === "managed") expect(within(section).getByText(/managed@example.com/)).toBeInTheDocument();

    await click(screen.getByRole("button", { name: mode === "managed" ? /My Webex connection/ : /Managed Webex account/ }));
    await screen.findByRole("button", { name: "New room" });
    expect(within(section).getByText("Other room")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accessible room" })).not.toBeInTheDocument();
    expect(mockChange).not.toHaveBeenCalled();

    await click(screen.getByRole("button", { name: mode === "managed" ? /Managed Webex account/ : /My Webex connection/ }));
    expect(screen.getByRole("button", { name: "Accessible room" })).toBeInTheDocument();
    expect(within(section).getByText("Other room")).toBeInTheDocument();
    expect(mockChange).not.toHaveBeenCalled();
  });

  it("preserves inaccessible rooms and existing metadata when adding a room", async () => {
    render(<Editor />);
    await screen.findByRole("button", { name: "Accessible room" });
    await click(await screen.findByRole("button", { name: "New room" }));
    expect(mockChange).toHaveBeenLastCalledWith(expect.objectContaining({
      repos: ["https://github.com/example/repo"],
      webex_credential_mode: "managed",
      webex_rooms: expect.arrayContaining([other, available, { room_id: "new", name: "New room", slug: "new-room" }]),
    }));
  });

  it("removes only the explicitly removed inaccessible room, even on the other tab", async () => {
    render(<Editor />);
    await screen.findByRole("button", { name: "Remove Other room" });
    await click(screen.getByRole("button", { name: /My Webex connection/ }));
    await click(screen.getByRole("button", { name: "Remove Other room" }));
    expect(mockChange).toHaveBeenLastCalledWith(expect.objectContaining({
      webex_credential_mode: "managed", webex_rooms: [available],
    }));
  });

  it("does not reassign retained rooms to the other account when adding", async () => {
    render(<Editor />);
    await screen.findByRole("button", { name: "Remove Other room" });
    await click(screen.getByRole("button", { name: /My Webex connection/ }));
    await click(await screen.findByRole("button", { name: "New room" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/different account/);
    expect(mockChange).not.toHaveBeenCalled();
  });

  it("lets an empty project choose an account by selecting its first room", async () => {
    render(<Editor rooms={[]} />);
    await click(await screen.findByRole("button", { name: /My Webex connection/ }));
    await click(await screen.findByRole("button", { name: "New room" }));
    expect(mockChange).toHaveBeenLastCalledWith(expect.objectContaining({
      webex_credential_mode: "personal", webex_credential_provider: "webex",
      webex_rooms: [{ room_id: "new", name: "New room", slug: "new-room" }],
    }));
  });

  it("rechecks memberships through the existing Refresh button", async () => {
    render(<Editor />);
    await screen.findByRole("button", { name: "Remove Other room" });
    statuses = { available: "accessible", other: "accessible" };
    await click(screen.getByTitle("Refresh"));
    expect(await screen.findByRole("button", { name: "Other room" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Rooms added by other users" })).queryByText("Other room")).not.toBeInTheDocument();
    expect(mockChange).not.toHaveBeenCalled();
  });

  it("shows unknown access separately and preserves those rooms on selection", async () => {
    accessFails = true;
    render(<Editor />);
    await screen.findByText("Could not verify room access");
    expect(within(screen.getByRole("region", { name: "Rooms added by other users" })).queryByText("Other room")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Unverified saved rooms" })).getByText("Other room")).toBeInTheDocument();
    await click(await screen.findByRole("button", { name: "New room" }));
    expect(mockChange).toHaveBeenLastCalledWith(expect.objectContaining({ webex_rooms: expect.arrayContaining([available, other]) }));
  });

  it("ignores an old access request after refresh", async () => {
    let resolveOld!: (value: Response) => void;
    const normalFetch = global.fetch;
    let first = true;
    global.fetch = jest.fn((url, init) => {
      if (first && String(url).includes("webex-room-access")) {
        first = false;
        return new Promise<Response>((resolve) => { resolveOld = resolve; });
      }
      return normalFetch(url, init);
    });
    render(<Editor />);
    await screen.findByRole("button", { name: "New room" });
    await click(screen.getByTitle("Refresh"));
    await screen.findByRole("button", { name: "Remove Other room" });
    await act(async () => { resolveOld({ ok: true, json: async () => ({ data: { mode: "managed", rooms: { other: "accessible" } } }) } as Response); });
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Rooms added by other users" })).getByText("Other room")).toBeInTheDocument());
  });
});
