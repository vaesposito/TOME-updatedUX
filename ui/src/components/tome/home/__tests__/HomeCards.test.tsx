/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { HomeAskAgent } from "../HomeAskAgent";
import { HomeEmpty } from "../HomeCard";
import { HomeKpis } from "../HomeKpis";
import { HomeMilestones } from "../HomeMilestones";
import { HomeNotificationList } from "../HomeNotificationRow";
import { HomeTeam } from "../HomeTeam";
import type { TomeSummaryItem } from "@/types/tome-summary";

function item(overrides: Partial<TomeSummaryItem> = {}): TomeSummaryItem {
  return {
    id: "n1",
    title: "Observability Baseline posted October status",
    message: "",
    category: "update",
    severity: "info",
    event_label: "",
    entity_slug: "example-project",
    entity_title: "Example Project",
    entity_type: "project",
    created_at: "2026-10-10T12:00:00.000Z",
    open_days: 0,
    read: false,
    needs_attention: false,
    resolved: false,
    reason: "in_scope",
    following: true,
    ...overrides,
  };
}

describe("HomeEmpty", () => {
  it("says what is missing, what fills it, and one way to go and do that", () => {
    render(
      <HomeEmpty
        icon={<svg />}
        headline="No roadmap page yet"
        hint="Milestones live in the roadmap's own table."
        action={{ label: "Open the roadmap", href: "/roadmap" }}
      />,
    );
    expect(screen.getByText("No roadmap page yet")).toBeInTheDocument();
    expect(
      screen.getByText("Milestones live in the roadmap's own table."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the roadmap" })).toHaveAttribute(
      "href",
      "/roadmap",
    );
  });

  it("keeps the illustration out of the reading, which the headline carries", () => {
    const { container } = render(
      <HomeEmpty
        icon={<svg data-testid="art" />}
        headline="Nothing connected yet"
        hint="A repository gives the agent something to read."
        action={{ label: "Connect a source", href: "/ingest" }}
      />,
    );
    expect(container.querySelector("[aria-hidden='true']")).toContainElement(
      screen.getByTestId("art"),
    );
  });

  it("offers a view the page can open itself over a route", () => {
    const onClick = jest.fn();
    render(
      <HomeEmpty
        icon={<svg />}
        headline="Nothing connected yet"
        hint="A repository gives the agent something to read."
        action={{ label: "Connect a source", onClick }}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect a source" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("HomeAskAgent", () => {
  it("sends the typed question on", () => {
    const onAsk = jest.fn();
    render(<HomeAskAgent title="Example Project" onAsk={onAsk} />);
    fireEvent.change(screen.getByLabelText("Ask the agent"), {
      target: { value: "What shipped?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(onAsk).toHaveBeenCalledWith("What shipped?");
  });

  it("names the space it asks about", () => {
    render(<HomeAskAgent title="Example Project" onAsk={() => {}} />);
    expect(
      screen.getByPlaceholderText("Ask anything about Example Project"),
    ).toBeInTheDocument();
  });

  it("will not send an empty question", () => {
    const onAsk = jest.fn();
    render(<HomeAskAgent title="Example Project" onAsk={onAsk} />);
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Ask the agent"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("sends on Enter but takes a newline on Shift", () => {
    const onAsk = jest.fn();
    render(<HomeAskAgent title="Example Project" onAsk={onAsk} />);
    const field = screen.getByLabelText("Ask the agent");
    fireEvent.change(field, { target: { value: "Why?" } });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(onAsk).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onAsk).toHaveBeenCalledWith("Why?");
  });

  it("fills the box from an opener rather than sending it", () => {
    const onAsk = jest.fn();
    render(<HomeAskAgent title="Example Project" onAsk={onAsk} />);
    fireEvent.click(screen.getByRole("button", { name: "What is blocking us?" }));
    expect(screen.getByLabelText("Ask the agent")).toHaveValue(
      "What is blocking us?",
    );
    expect(onAsk).not.toHaveBeenCalled();
  });
});

describe("HomeNotificationList", () => {
  const list = (items: TomeSummaryItem[], viewing = "example-project") =>
    render(
      <HomeNotificationList
        items={items}
        viewing={viewing}
        limit={5}
        empty={<p>Nothing yet.</p>}
      />,
    );

  it("says what is missing when there is nothing", () => {
    list([]);
    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
  });

  it("stops at the limit it is given", () => {
    render(
      <HomeNotificationList
        items={[item({ id: "a" }), item({ id: "b" }), item({ id: "c" })]}
        viewing="example-project"
        limit={2}
        empty={<p>Nothing yet.</p>}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("leaves the entity unsaid on its own page", () => {
    list([item()]);
    expect(screen.queryByText(/Example Project/)).not.toBeInTheDocument();
  });

  it("names the entity when the row came from somewhere else", () => {
    list([item({ entity_slug: "other-project", entity_title: "Other Project" })]);
    expect(screen.getByText(/Other Project/)).toBeInTheDocument();
  });

  it("marks a row read when it is followed", () => {
    const onOpen = jest.fn();
    render(
      <HomeNotificationList
        items={[item({ href: "/projects/example-project/tome/wiki/charter.md" })]}
        viewing="example-project"
        limit={5}
        onOpen={onOpen}
        empty={<p>Nothing yet.</p>}
      />,
    );
    fireEvent.click(screen.getByRole("link"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("says a settled row is resolved rather than dating it", () => {
    list([item({ resolved: true })]);
    expect(screen.getByText("Resolved")).toBeInTheDocument();
  });
});

describe("HomeMilestones", () => {
  const ROADMAP = [
    "## Milestones",
    "| Milestone | Target (Qtr / Month) | Owner | Status |",
    "| --- | --- | --- | --- |",
    "| Public beta | Q2 FY26 | Platform Guild | In progress |",
    "| Shipped thing | Q1 FY26 | Platform Guild | Done |",
  ].join("\n");

  it("shows each milestone with its target, owner and status", () => {
    render(<HomeMilestones markdown={ROADMAP} roadmapHref="/roadmap" />);
    expect(screen.getByText("Public beta")).toBeInTheDocument();
    expect(screen.getByText("Q2 FY26 · Platform Guild")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("leads with what has not landed", () => {
    render(<HomeMilestones markdown={ROADMAP} roadmapHref="/roadmap" />);
    const titles = screen
      .getAllByRole("listitem")
      .map((row) => row.textContent ?? "");
    expect(titles[0]).toContain("Public beta");
  });

  it("distinguishes a page that is missing from one that is unfilled", () => {
    const { unmount } = render(
      <HomeMilestones markdown={null} roadmapHref="/roadmap" />,
    );
    expect(screen.getByText("No roadmap page yet")).toBeInTheDocument();
    unmount();

    render(<HomeMilestones markdown="## Milestones" roadmapHref="/roadmap" />);
    expect(screen.getByText("No milestones filled in yet")).toBeInTheDocument();
  });

  it("offers the page that would fill it", () => {
    render(<HomeMilestones markdown={null} roadmapHref="/roadmap" />);
    expect(
      screen.getByRole("link", { name: "Open the roadmap" }),
    ).toHaveAttribute("href", "/roadmap");
  });
});

describe("HomeKpis", () => {
  it("shows a KPI's target with its baseline and time frame", () => {
    const charter = [
      "## KPIs",
      "| Metric | Baseline | Target | Time frame |",
      "| --- | --- | --- | --- |",
      "| Weekly active teams | 12 | 80 | Q4 FY26 |",
    ].join("\n");
    render(<HomeKpis markdown={charter} charterHref="/charter" />);
    expect(screen.getByText("Weekly active teams")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("from 12 · by Q4 FY26")).toBeInTheDocument();
  });

  it("distinguishes a page that is missing from one that is unfilled", () => {
    const { unmount } = render(<HomeKpis markdown={null} charterHref="/charter" />);
    expect(screen.getByText("No charter page yet")).toBeInTheDocument();
    unmount();

    render(<HomeKpis markdown="## KPIs" charterHref="/charter" />);
    expect(screen.getByText("No KPIs filled in yet")).toBeInTheDocument();
  });

  it("offers the page that would fill it", () => {
    render(<HomeKpis markdown={null} charterHref="/charter" />);
    expect(
      screen.getByRole("link", { name: "Open the charter" }),
    ).toHaveAttribute("href", "/charter");
  });
});

describe("HomeTeam", () => {
  const roster = {
    team: { slug: "platform-guild", name: "Platform Guild" },
    members: [
      { email: "lead@example.com", name: "Dana Okafor", avatar_url: null, role: "owner", idp_managed: true },
      { email: "dev@example.com", name: "Jordan Mapfumo", avatar_url: null, role: "member", idp_managed: false },
    ],
    total: 9,
    steward: "Platform Guild",
    watchers: 1,
  };

  function answer(body: unknown, ok = true) {
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => ({ data: body }) }),
    );
  }

  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
  });

  it("lists the team and counts the members it did not show", async () => {
    answer(roster);
    render(<HomeTeam slug="example-project" settingsHref="/settings" />);
    expect(await screen.findByText("Platform Guild")).toBeInTheDocument();
    expect(screen.getByText("Dana Okafor")).toBeInTheDocument();
    expect(screen.getByText("and 7 others")).toBeInTheDocument();
  });

  it("calls out the one role that is not simply a member", async () => {
    answer(roster);
    render(<HomeTeam slug="example-project" settingsHref="/settings" />);
    expect(await screen.findByText("owner")).toBeInTheDocument();
    expect(screen.queryByText("member")).not.toBeInTheDocument();
  });

  it("says who can edit and how many are listening", async () => {
    answer(roster);
    render(<HomeTeam slug="example-project" settingsHref="/settings" />);
    expect(await screen.findByText("Platform Guild can edit")).toBeInTheDocument();
    expect(screen.getByText("1 person is watching")).toBeInTheDocument();
  });

  it("reports an unowned space rather than an empty list", async () => {
    answer({ team: null, members: [], total: 0, steward: null, watchers: 0 });
    render(<HomeTeam slug="example-project" settingsHref="/settings" />);
    expect(await screen.findByText(/No team owns this space yet/)).toBeInTheDocument();
    expect(screen.getByText("No data steward assigned")).toBeInTheDocument();
  });

  it("says so when the roster cannot be read", async () => {
    answer(null, false);
    render(<HomeTeam slug="example-project" settingsHref="/settings" />);
    expect(await screen.findByText("Could not load the team")).toBeInTheDocument();
  });

  it("waits rather than reporting an empty team it has not read yet", () => {
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));
    render(<HomeTeam slug="example-project" settingsHref="/settings" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText(/No members on record/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No team owns/)).not.toBeInTheDocument();
  });

  it("reads the roster again when asked to try again", async () => {
    (global.fetch as jest.Mock)
      .mockImplementationOnce(() => Promise.reject(new Error("offline")))
      .mockImplementation(() =>
        Promise.resolve({ ok: true, status: 200, json: async () => ({ data: roster }) }),
      );
    render(<HomeTeam slug="example-project" settingsHref="/settings" />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Dana Okafor")).toBeInTheDocument();
  });

  it("asks only for the project it was given", async () => {
    answer(roster);
    render(<HomeTeam slug="example-project" settingsHref="/settings" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      "/api/tome/projects/example-project/team",
    );
  });
});
