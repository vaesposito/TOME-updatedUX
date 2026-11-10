/** @jest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";

import { MeetingsView } from "@/components/tome/MeetingsView";

const fetchMock = jest.fn();

function reply(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ data }) } as Response);
}

describe("MeetingsView", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("offers somewhere to go when a space listens to nothing", async () => {
    fetchMock.mockImplementation(() => reply({ subscriptions: [], occurrences: [] }));

    render(<MeetingsView slug="example-project" />);

    await waitFor(() =>
      expect(screen.getByText("No meetings yet")).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: /Set up Webex/ })).toHaveAttribute(
      "href",
      "/projects/example-project/tome/settings",
    );
  });

  it("lists each series with what came of its calls", async () => {
    fetchMock.mockImplementation(() =>
      reply({
        subscriptions: [{ id: "series-1", title: "Weekly Sync" }],
        occurrences: [
          {
            id: "one",
            subscriptionId: "series-1",
            title: "Weekly Sync, 6 January",
            start: "2026-01-06T10:00:00.000Z",
            status: "ingested",
          },
          {
            id: "two",
            subscriptionId: "series-1",
            title: "Weekly Sync, 13 January",
            start: "2026-01-13T10:00:00.000Z",
            status: "waiting_transcript",
          },
        ],
      }),
    );

    render(<MeetingsView slug="example-project" />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Weekly Sync" })).toBeInTheDocument(),
    );
    // Plain words over the stored status, which says "ingested" where a
    // reader asked whether the call was written up.
    expect(screen.getByText("Written up")).toBeInTheDocument();
    expect(screen.getByText("Waiting for the transcript")).toBeInTheDocument();

    // Newest first: the question asked here is almost always about the call
    // that just happened.
    const held = screen.getAllByRole("listitem");
    expect(held[0]).toHaveTextContent("Waiting for the transcript");
  });

  it("says a subscribed series has not met yet, rather than showing nothing", async () => {
    fetchMock.mockImplementation(() =>
      reply({
        subscriptions: [{ id: "series-1", title: "Weekly Sync" }],
        occurrences: [],
      }),
    );

    render(<MeetingsView slug="example-project" />);

    await waitFor(() => expect(screen.getByText("Weekly Sync")).toBeInTheDocument());
    expect(screen.getByText(/Nothing held yet/)).toBeInTheDocument();
  });

  it("reports a read it could not make", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response),
    );

    render(<MeetingsView slug="example-project" />);

    await waitFor(() =>
      expect(
        screen.getByText("Could not load this space's meetings."),
      ).toBeInTheDocument(),
    );
  });
});
