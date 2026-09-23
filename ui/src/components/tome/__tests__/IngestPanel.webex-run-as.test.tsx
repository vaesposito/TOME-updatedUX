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
    setup({ run_as: { mode, name: "Example Account", email: "account@example.com" } });
    for (const name of ["First space", "Second space"]) {
      const room = (await screen.findByText(name)).closest("li")!;
      expect(within(room).getByText(/Runs as: Example Account \(account@example.com\)/)).toBeInTheDocument();
      expect(room.textContent?.includes("managed account")).toBe(mode === "managed");
    }
    const repo = screen.getByText("example/repo").closest("li")!;
    expect(within(repo).queryByText(/Runs as/)).not.toBeInTheDocument();
  });

  it("shows missing credentials instead of implying an account can run", async () => {
    setup({ no_token: true });
    expect(await screen.findAllByText(/Runs as: not connected/)).toHaveLength(2);
  });
});
