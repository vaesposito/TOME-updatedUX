import { render, screen, within } from "@testing-library/react";

import type { PreflightSourceResult } from "@/lib/tome/preflight";
import { IngestPanel } from "../IngestPanel";

describe("Webex space run-as labels", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  function setup(preflight: Partial<PreflightSourceResult>) {
    global.fetch = jest.fn(async (url) => ({
      ok: true,
      json: async () => ({ data: String(url).endsWith("/preflight")
        ? { sources: [{ provider: "webex", accessible: [], inaccessible: [], no_token: false, ...preflight }] }
        : { runs: [], project: { sources: {
          repos: ["example/repo"],
          webex_rooms: [{ room_id: "room-1", name: "First space" }, { room_id: "room-2", name: "Second space" }],
        } } } }),
    } as Response));
    render(<IngestPanel slug="example" canEdit onOpenRun={jest.fn()} onReviewDraft={jest.fn()} onRunStarted={jest.fn()} />);
  }

  it.each(["managed", "personal"] as const)("labels every room with the resolved %s identity", async (mode) => {
    setup({ rooms: ["room-1", "room-2"].map((room_id) => ({ room_id, name: room_id, mode, available: true, access: "accessible",
      run_as: { mode, name: "Example Account", email: "account@example.com" } })) });
    for (const name of ["First space", "Second space"]) {
      const room = (await screen.findByText(name)).closest("li")!;
      expect(within(room).getByText(/Runs as: Example Account \(account@example.com\)/)).toBeInTheDocument();
      expect(room.textContent).toContain("Example Account");
    }
    const repo = screen.getByText("example/repo").closest("li")!;
    expect(within(repo).queryByText(/Runs as/)).not.toBeInTheDocument();
  });

  it("shows missing credentials instead of implying an account can run", async () => {
    setup({ no_token: true });
    expect(await screen.findAllByText(/Runs as: Your Webex connection/)).toHaveLength(2);
    expect(screen.queryByRole("region", { name: "Will be ingested" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Access not verified" })).toBeInTheDocument();
  });

  it("names the configured connector in personal-space connection warnings", async () => {
    setup({ rooms: ["room-1", "room-2"].map((room_id) => ({ room_id, name: room_id,
      mode: "personal", available: false, access: "unknown", no_token: true,
      connection: { provider: "custom_messaging", name: "Example Messaging" },
    })) });
    expect(await screen.findAllByText("Connect Example Messaging to access this space.")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Connect Example Messaging in Connections →" })).toHaveAttribute("target", "_blank");
  });

  it("confirms managed spaces will still ingest when the user has no personal connection", async () => {
    setup({ no_token: true, detail: "Do not render the misleading aggregate warning", rooms: [
      { room_id: "room-1", name: "First space", mode: "managed", available: true, access: "accessible",
        run_as: { mode: "managed", name: "Example Account", email: "account@example.com" } },
      { room_id: "room-2", name: "Second space", mode: "personal", available: false, access: "unknown", no_token: true },
    ] });
    const ready = await screen.findByRole("region", { name: "Will be ingested" });
    expect(within(ready).getByText("First space")).toBeInTheDocument();
    expect(within(ready).queryByText("Second space")).not.toBeInTheDocument();
    expect(within(ready).getByText(/You can still run ingest/)).toBeInTheDocument();
    expect(within(ready).getByText(/don't require your own Webex connection or membership/)).toBeInTheDocument();
    const skipped = screen.getByRole("region", { name: "Won't be ingested" });
    expect(within(skipped).getByText("Second space")).toBeInTheDocument();
    expect(within(skipped).queryByText("First space")).not.toBeInTheDocument();
    expect(within(skipped).getByText("Connect your Webex account to access this space.")).toBeInTheDocument();
    expect(screen.queryByText("Do not render the misleading aggregate warning")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Connect Webex in Connections →" });
    expect(link).toHaveAttribute("href", "/credentials");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("distinguishes missing room access from a missing connection", async () => {
    setup({ rooms: [
      { room_id: "room-1", name: "First space", mode: "personal", available: true, access: "accessible" },
      { room_id: "room-2", name: "Second space", mode: "personal", available: false, access: "inaccessible" },
    ] });
    const skipped = await screen.findByRole("region", { name: "Won't be ingested" });
    expect(within(skipped).getByText("You don't have access to this space, or it no longer exists.")).toBeInTheDocument();
    expect(screen.queryByText("Connect your Webex account to access this space.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect Webex in Connections →" })).not.toBeInTheDocument();
  });

  it("does not claim a timeout or provider error means the user lacks access", async () => {
    setup({ rooms: [
      { room_id: "room-1", name: "First space", mode: "managed", available: true, access: "accessible" },
      { room_id: "room-2", name: "Second space", mode: "personal", available: false, access: "unknown", detail: "No access to Second space" },
    ] });
    const unknown = await screen.findByRole("region", { name: "Access not verified" });
    expect(within(unknown).getByText("Second space")).toBeInTheDocument();
    expect(within(unknown).getByText("Could not verify access to this space. Refresh and try again.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Won't be ingested" })).not.toBeInTheDocument();
    expect(screen.queryByText("No access to Second space")).not.toBeInTheDocument();
  });

  it.each([
    { access: "unknown" as const, no_token: true },
    { access: "inaccessible" as const },
    { access: "unknown" as const },
  ])("does not promise partial ingest when a managed account failure blocks dispatch (%j)", async (failure) => {
    setup({ rooms: [
      { room_id: "room-1", name: "First space", mode: "personal", available: true, access: "accessible" },
      { room_id: "room-2", name: "Second space", mode: "managed", available: false, ...failure },
    ] });
    const blocked = await screen.findByRole("region", { name: "Ingest blocked" });
    expect(within(blocked).getByText("Second space")).toBeInTheDocument();
    expect(within(blocked).getByText(/contact an administrator/i)).toBeInTheDocument();
    expect(screen.getByText("Ingest cannot start while the managed-account spaces below are unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Access confirmed" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Will be ingested" })).not.toBeInTheDocument();
  });

  it("does not show a ready group when all personal spaces lack credentials", async () => {
    setup({ no_token: true, rooms: ["room-1", "room-2"].map((room_id) => ({
      room_id, name: room_id, mode: "personal", available: false, access: "unknown", no_token: true,
    })) });
    const skipped = await screen.findByRole("region", { name: "Won't be ingested" });
    expect(within(skipped).getAllByText("Connect your Webex account to access this space.")).toHaveLength(2);
    expect(screen.queryByRole("region", { name: "Will be ingested" })).not.toBeInTheDocument();
  });
});
