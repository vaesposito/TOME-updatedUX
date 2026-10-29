import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { TomeNotificationSettings } from "@/components/tome/TomeNotificationSettings";

const NODES = [
  {
    slug: "example-goal",
    title: "Example Goal",
    type: "bhag",
    entity_slug: "example-goal",
    following: true,
    muted: false,
    unread: 0,
    subtree_unread: 0,
  },
  {
    slug: "example-area",
    title: "Example Area",
    type: "area",
    parent_slug: "example-goal",
    entity_slug: "example-area",
    following: true,
    muted: false,
    unread: 0,
    subtree_unread: 0,
  },
  {
    slug: "example-project",
    title: "Example Project",
    type: "project",
    parent_slug: "example-area",
    entity_slug: "example-project",
    following: false,
    muted: false,
    unread: 0,
    subtree_unread: 0,
  },
];

function mockTree(nodes: unknown[] = NODES) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { nodes, total_unread: 0 } }),
  }) as unknown as typeof fetch;
}

describe("TomeNotificationSettings", () => {
  afterEach(() => jest.restoreAllMocks());

  it("lists every space a reader can see, nested", async () => {
    mockTree();
    render(<TomeNotificationSettings />);
    expect(await screen.findByText("Example Goal")).toBeInTheDocument();
    expect(screen.getByText("Example Area")).toBeInTheDocument();
    expect(screen.getByText("Example Project")).toBeInTheDocument();
  });

  it("asks what, where and when before it asks about any one space", async () => {
    mockTree();
    render(<TomeNotificationSettings />);
    await screen.findByText("Example Goal");
    expect(screen.getByRole("heading", { name: "What type of notifications?" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Where would you like to be notified?" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "When would you like to be notified?" })).toBeInTheDocument();
  });

  it("will not let a reader pick Webex until it is connected", async () => {
    mockTree();
    render(<TomeNotificationSettings />);
    await screen.findByText("Example Goal");
    expect(screen.getByRole("checkbox", { name: "Webex" })).toBeDisabled();
    expect(screen.getByText(/Webex isn't connected yet/)).toBeInTheDocument();
  });

  it("keeps the quiet-hours times out of the way until quiet hours are on", async () => {
    mockTree();
    render(<TomeNotificationSettings />);
    await screen.findByText("Example Goal");
    expect(screen.queryByLabelText("From")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "Quiet hours" }));
    expect(screen.getByLabelText("From")).toHaveValue("22");
    expect(screen.getByLabelText("To")).toHaveValue("7");
  });

  it("puts the rest of the page out of reach when notifications are off entirely", async () => {
    mockTree();
    const { container } = render(<TomeNotificationSettings />);
    await screen.findByText("Example Goal");
    expect(container.querySelector("[inert]")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "Send me notifications" }));

    // Not merely dimmed: with notifications off these controls decide
    // nothing, so they should not be reachable by keyboard either.
    await waitFor(() => {
      expect(container.querySelector("[inert]")).toBeInTheDocument();
    });
    // jsdom carries the attribute without implementing what it means, so
    // the check is that the controls are inside the inert subtree.
    expect(screen.getByRole("heading", { name: "What type of notifications?" }).closest("[inert]"))
      .toBe(container.querySelector("[inert]"));
    expect(screen.getByRole("switch", { name: "Send me notifications" }).closest("[inert]"))
      .toBeNull();
  });

  it("sets a whole branch from the row above it", async () => {
    mockTree();
    render(<TomeNotificationSettings />);
    await screen.findByText("Example Goal");

    const goalLevel = screen.getByLabelText("How much to hear about Example Goal");
    fireEvent.change(goalLevel, { target: { value: "mentions" } });

    // The BHAG's own handful of pages is not what a reader means by turning
    // a BHAG down; everything under it follows.
    expect(screen.getByLabelText("How much to hear about Example Area")).toHaveValue("mentions");
    expect(screen.getByLabelText("How much to hear about Example Project")).toHaveValue("mentions");
  });

  it("says a column is Mixed rather than claiming one of its values", async () => {
    mockTree();
    render(<TomeNotificationSettings />);
    await screen.findByText("Example Goal");

    fireEvent.change(screen.getByLabelText("How much to hear about Example Project"), {
      target: { value: "mentions" },
    });

    const everySpace = screen.getByLabelText("How much to hear about every space");
    expect(everySpace).toHaveValue("");
    expect(within(everySpace).getByRole("option", { name: "Mixed" })).toBeInTheDocument();
  });

  it("is honest that nothing is kept yet", async () => {
    mockTree();
    render(<TomeNotificationSettings />);
    await screen.findByText("Example Goal");
    expect(screen.getByText(/Nothing here is saved yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("still shows the controls when the tree cannot be loaded", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    render(<TomeNotificationSettings />);
    expect(await screen.findByText(/Could not load your spaces/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What type of notifications?" })).toBeInTheDocument();
  });

  it("draws the account's own choices alone when asked for that half", async () => {
    mockTree();
    render(<TomeNotificationSettings section="account" />);
    await screen.findByRole("heading", { name: "What type of notifications?" });

    expect(screen.getByLabelText("Send me notifications")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "When would you like to be notified?" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Followed spaces" })).not.toBeInTheDocument();
    expect(screen.queryByText("Example Goal")).not.toBeInTheDocument();
  });

  it("draws the spaces alone when asked for that half", async () => {
    mockTree();
    render(<TomeNotificationSettings section="spaces" />);
    expect(await screen.findByText("Example Goal")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Followed spaces" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "What type of notifications?" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Send me notifications")).not.toBeInTheDocument();
  });

  it("leaves Save to a panel that already carries one, but keeps saying nothing is kept", async () => {
    mockTree();
    render(<TomeNotificationSettings section="spaces" showSave={false} />);
    await screen.findByText("Example Goal");

    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing here is saved yet/)).toBeInTheDocument();
  });
});
