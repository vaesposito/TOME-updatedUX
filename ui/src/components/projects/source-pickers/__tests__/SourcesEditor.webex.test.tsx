import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { ProjectSources } from "@/types/projects";
import { SourcesEditor } from "../SourcesEditor";

const mockChange = jest.fn();
const originalFetch = global.fetch;

function Editor({ initial }: { initial: ProjectSources }) {
  const [sources, setSources] = useState(initial);
  return <SourcesEditor kinds={["webex"]} value={sources} onChange={(next) => {
    mockChange(next);
    setSources(next);
  }} />;
}

describe("Webex source selections belong to the active account", () => {
  beforeEach(() => {
    mockChange.mockReset();
    global.fetch = jest.fn(async (url) => ({
      ok: true,
      json: async () => ({ data: {
        connected: true,
        options: [{ value: "shared-room", label: "Shared room" }],
        managedCapability: { available: true, provider: "webex_messaging" },
        ...(String(url).includes("capability_only") ? { options: [] } : {}),
      } }),
    } as Response));
  });

  afterEach(() => { global.fetch = originalFetch; });

  it.each(["personal", "managed"] as const)("clears selected rooms when switching away from %s", async (mode) => {
    const initial: ProjectSources = {
      repos: ["https://github.com/example/repo"],
      confluence_url: "https://example.test/wiki",
      webex_credential_mode: mode,
      webex_credential_provider: mode === "personal" ? "webex" : "webex_messaging",
      webex_rooms: [{ room_id: "selected-room", name: "Previously selected room", slug: "selected-room" }],
    };
    render(<Editor initial={initial} />);
    expect(await screen.findByRole("button", { name: "Previously selected room" })).toBeInTheDocument();
    expect(mockChange).not.toHaveBeenCalled();
    const target = mode === "personal" ? /Managed Webex account/ : /My Webex connection/;
    fireEvent.click(await screen.findByRole("button", { name: target }));

    expect(screen.queryByRole("button", { name: "Previously selected room" })).not.toBeInTheDocument();
    expect(screen.queryByText("1 room selected")).not.toBeInTheDocument();
    expect(mockChange).toHaveBeenLastCalledWith({
      ...initial,
      webex_credential_mode: mode === "personal" ? "managed" : "personal",
      webex_credential_provider: mode === "personal" ? "webex_messaging" : "webex",
      webex_rooms: [],
    });
    await screen.findByRole("button", { name: "Shared room" });
  });

  it("keeps the active account's selection, but does not carry even a shared room across accounts", async () => {
    render(<Editor initial={{
      // An older project without an explicit mode is personal.
      webex_rooms: [{ room_id: "shared-room", name: "Shared room", slug: "shared-room" }],
    }} />);
    await screen.findByRole("button", { name: "Shared room" });
    fireEvent.click(screen.getByRole("button", { name: /My Webex connection/ }));
    expect(mockChange).not.toHaveBeenCalled();
    expect(screen.getByText("1 room selected")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /Managed Webex account/ }));
    await screen.findByRole("button", { name: "Shared room" });
    expect(screen.queryByText("1 room selected")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Shared room" }));
    expect(screen.getByText("1 room selected")).toBeInTheDocument();
    mockChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Managed Webex account/ }));
    expect(mockChange).not.toHaveBeenCalled();
    expect(screen.getByText("1 room selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /My Webex connection/ }));
    await waitFor(() => expect(screen.queryByText("1 room selected")).not.toBeInTheDocument());
    expect(mockChange).toHaveBeenLastCalledWith(expect.objectContaining({ webex_rooms: [] }));
    await screen.findByRole("button", { name: "Shared room" });
  });
});
