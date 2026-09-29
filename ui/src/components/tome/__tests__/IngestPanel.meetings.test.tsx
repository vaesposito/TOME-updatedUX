import { fireEvent, render, screen } from "@testing-library/react";

import { IngestPanel } from "../IngestPanel";

describe("IngestPanel meeting connection prompt", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it.each(["Webex (Legacy)", "Team Meetings"])("uses the exact connector display name: %s", async (name) => {
    global.fetch = jest.fn(async (url) => ({
      ok: true,
      json: async () => ({ data: String(url).includes("/webex-meetings")
        ? { meetings: [], connection: { provider: "custom_provider", name } }
        : { runs: [], project: { sources: {} }, sources: [] } }),
    } as Response));
    render(<IngestPanel slug="example" canEdit onOpenRun={jest.fn()} onReviewDraft={jest.fn()} onRunStarted={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Add context: recorded Webex meetings/ }));
    expect(await screen.findByText(`No meetings found. Connect ${name} in`, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/Connect custom_provider/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "/credentials" })).toHaveAttribute("target", "_blank");
  });
});
