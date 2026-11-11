import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FollowMenu } from "@/components/tome/FollowMenu";

function mockWatch(watching: boolean, watcherCount = 0) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { watching, watcher_count: watcherCount } }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("FollowMenu", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("offers to follow a space nobody is watching yet", async () => {
    mockWatch(false);
    render(<FollowMenu slug="example-project" />);
    expect(await screen.findByRole("button", { name: /Follow/ })).toBeInTheDocument();
  });

  it("says Following once the space is watched, with its watcher count", async () => {
    mockWatch(true, 3);
    render(<FollowMenu slug="example-project" />);
    const button = await screen.findByRole("button", { name: /Following/ });
    expect(button).toHaveTextContent("3");
  });

  it("stays out of a header where watching cannot succeed", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;
    const { container } = render(<FollowMenu slug="example-project" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("offers four levels and ticks the one in force", async () => {
    mockWatch(true);
    render(<FollowMenu slug="example-project" />);
    fireEvent.click(await screen.findByRole("button", { name: /Following/ }));

    const items = await screen.findAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual([
      "EverythingEvery edit, ingest, and update",
      "ImportantDecisions, critical items, milestones",
      "MentionsOnly when you're named or assigned",
      "OffNothing from here",
    ]);
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    expect(items[3]).toHaveAttribute("aria-checked", "false");
  });

  it("unsubscribes when the reader picks Off", async () => {
    const fetchMock = mockWatch(true);
    render(<FollowMenu slug="example-project" />);
    fireEvent.click(await screen.findByRole("button", { name: /Following/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Off/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/example-project/watch",
        { method: "DELETE" },
      );
    });
  });

  it("does not re-subscribe when moving between the levels that all mean following", async () => {
    const fetchMock = mockWatch(true);
    render(<FollowMenu slug="example-project" />);
    fireEvent.click(await screen.findByRole("button", { name: /Following/ }));

    const before = fetchMock.mock.calls.length;
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Important/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Following/ })).toBeInTheDocument();
    });
    // Everything and Important are both "following", so there is nothing to
    // tell the server: only the ends of the scale are wired to anything.
    expect(fetchMock.mock.calls).toHaveLength(before);
  });

  it("points at the full settings rather than repeating them", async () => {
    mockWatch(false);
    render(<FollowMenu slug="example-project" />);
    fireEvent.click(await screen.findByRole("button", { name: /Follow/ }));
    expect(await screen.findByRole("link", { name: /Manage notifications/ }))
      .toHaveAttribute("href", "/settings/notifications");
  });
});
