/** @jest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";

import { HomeAbout } from "../HomeAbout";
import { HomeChanges } from "../HomeChanges";
import { HomeDecisions } from "../HomeDecisions";
import { HomeSources } from "../HomeSources";

function answer(body: unknown, { ok = true, status = 200 } = {}) {
  (global.fetch as jest.Mock).mockImplementation(() =>
    Promise.resolve({ ok, status, json: async () => ({ data: body }) }),
  );
}

beforeEach(() => {
  (global.fetch as jest.Mock).mockClear();
});

describe("HomeAbout", () => {
  const description =
    "A long description that used to be clipped to one line under the title, " +
    "with the rest of it only readable by hovering the paragraph.";

  it("shows the whole description, unclipped", () => {
    const { container } = render(
      <HomeAbout description={description} settingsHref="/settings" />,
    );
    const paragraph = screen.getByText(description);
    expect(paragraph).toBeInTheDocument();
    expect(paragraph.className).not.toContain("line-clamp");
    expect(container.querySelector("[role='tooltip']")).toBeNull();
  });

  it("tells a waiting reader apart from an undescribed space", () => {
    const { unmount } = render(
      <HomeAbout description={null} settingsHref="/settings" loading />,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("Not described yet")).not.toBeInTheDocument();
    unmount();

    render(<HomeAbout description="   " settingsHref="/settings" />);
    expect(screen.getByText("Not described yet")).toBeInTheDocument();
  });
});

describe("HomeChanges", () => {
  const run = (id: string, content: string, minutesAgo: number) => ({
    id,
    content,
    message_type: "event",
    created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    metadata: { kind: "ingest_event", correlation_id: "run-1" },
  });

  it("reads a run's transitions as one row", async () => {
    answer({
      messages: [
        run("started", "Ingest started", 180),
        run("finished", "Ingest completed", 20),
      ],
    });
    render(
      <HomeChanges
        slug="example-project"
        feedHref="/feed"
        ingestHref="/ingest"
      />,
    );
    expect(await screen.findByText("Ingest completed")).toBeInTheDocument();
    expect(screen.queryByText("Ingest started")).not.toBeInTheDocument();
  });

  it("asks the space's own feed for a window wide enough to collapse", async () => {
    answer({ messages: [] });
    render(
      <HomeChanges
        slug="example-project"
        feedHref="/feed"
        ingestHref="/ingest"
      />,
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      "/api/tome/projects/example-project/feed?limit=200",
    );
  });

  it("says a quiet week is quiet rather than broken", async () => {
    answer({ messages: [] });
    render(
      <HomeChanges
        slug="example-project"
        feedHref="/feed"
        ingestHref="/ingest"
      />,
    );
    expect(await screen.findByText("A quiet week")).toBeInTheDocument();
  });

  it("says plainly when there is no feed behind this deployment", async () => {
    answer(null, { ok: false, status: 503 });
    render(
      <HomeChanges
        slug="example-project"
        feedHref="/feed"
        ingestHref="/ingest"
      />,
    );
    expect(await screen.findByText("No activity feed here")).toBeInTheDocument();
  });

  it("offers a retry rather than an empty week when the request fails", async () => {
    answer(null, { ok: false, status: 500 });
    render(
      <HomeChanges
        slug="example-project"
        feedHref="/feed"
        ingestHref="/ingest"
      />,
    );
    expect(await screen.findByText("Could not load this week")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("HomeDecisions", () => {
  const decision = (overrides: Record<string, unknown> = {}) => ({
    id: "d1",
    title: "Adopt the shared ingest schedule",
    status: "proposed",
    priority: "high",
    owner: "test-user@example.com",
    opened: "2026-03-01",
    source_project_slug: "example-project",
    path: "decisions/shared-ingest-schedule.md",
    ...overrides,
  });

  it("shows decisions that are still open and drops the settled ones", async () => {
    answer({
      items: [
        decision(),
        decision({ id: "d2", title: "Settled already", status: "accepted" }),
        decision({ id: "d3", title: "Turned down", status: "rejected" }),
      ],
    });
    render(<HomeDecisions slug="example-project" ingestHref="/ingest" />);
    expect(
      await screen.findByText("Adopt the shared ingest schedule"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Settled already")).not.toBeInTheDocument();
    expect(screen.queryByText("Turned down")).not.toBeInTheDocument();
  });

  it("links a decision rolled up from another space at that space", async () => {
    answer({
      items: [
        decision({
          id: "d4",
          title: "Decided elsewhere",
          source_project_slug: "other-example-project",
        }),
      ],
    });
    render(<HomeDecisions slug="example-project" ingestHref="/ingest" />);
    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "/projects/other-example-project/tome/wiki/decisions/shared-ingest-schedule.md",
    );
  });

  it("opens one of this space's own decisions without leaving the wiki", async () => {
    answer({ items: [decision()] });
    const onOpenPage = jest.fn();
    render(
      <HomeDecisions
        slug="example-project"
        ingestHref="/ingest"
        onOpenPage={onOpenPage}
      />,
    );
    const button = await screen.findByRole("button");
    button.click();
    expect(onOpenPage).toHaveBeenCalledWith(
      "decisions/shared-ingest-schedule.md",
    );
  });

  it("says there are none rather than showing an empty list", async () => {
    answer({ items: [] });
    render(<HomeDecisions slug="example-project" ingestHref="/ingest" />);
    expect(await screen.findByText("No open decisions")).toBeInTheDocument();
  });
});

describe("HomeSources reading", () => {
  const sources = { repos: ["https://example.com/example-org/example-repo"] };

  it("says when the sources were last read and when they will be again", () => {
    render(
      <HomeSources
        sources={sources}
        reading={{
          lastRun: { at: new Date(Date.now() - 3_600_000).toISOString(), status: "awaiting_review" },
          schedule: "Daily at 2:00 AM",
        }}
        ingestHref="/ingest"
      />,
    );
    expect(screen.getByText(/Last ingest 1h ago, awaiting review/)).toBeInTheDocument();
    expect(screen.getByText("Daily at 2:00 AM")).toBeInTheDocument();
  });

  it("distinguishes a space still being asked from one that has never run", () => {
    const { unmount } = render(
      <HomeSources sources={sources} reading={{}} ingestHref="/ingest" />,
    );
    expect(screen.getByText("Checking for a recent ingest…")).toBeInTheDocument();
    expect(screen.getByText("Not scheduled")).toBeInTheDocument();
    unmount();

    render(
      <HomeSources
        sources={sources}
        reading={{ lastRun: null, schedule: null }}
        ingestHref="/ingest"
      />,
    );
    expect(screen.getByText("No ingest has run yet")).toBeInTheDocument();
  });

  it("leaves the lines out where no single space is in view", () => {
    render(<HomeSources sources={sources} ingestHref="/ingest" />);
    expect(screen.queryByText("Not scheduled")).not.toBeInTheDocument();
  });
});
