/** @jest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import * as React from "react";

import type { TomeSummary, TomeSummaryItem } from "@/types/tome-summary";

jest.mock("@/lib/api-client", () => ({
  apiClient: {
    getSettings: () => Promise.resolve({ preferences: {} }),
    updatePreferences: () => Promise.resolve({}),
  },
}));

jest.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: jest.fn(),
  PointerSensor: jest.fn(),
  KeyboardSensor: jest.fn(),
  useSensor: jest.fn(),
  useSensors: jest.fn(() => []),
}));

jest.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    setActivatorNodeRef: jest.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  sortableKeyboardCoordinates: jest.fn(),
  rectSortingStrategy: "rect",
}));

import { WorkspaceOverview } from "@/components/tome/WorkspaceOverview";

function item(over: Partial<TomeSummaryItem>): TomeSummaryItem {
  return {
    id: over.id ?? "row",
    title: over.title ?? "A row",
    message: "",
    category: "general",
    severity: "info",
    event_label: "Updated",
    entity_slug: "example-area",
    entity_title: "Example Area",
    entity_type: "area",
    created_at: "2026-10-12T00:00:00.000Z",
    open_days: 0,
    read: false,
    needs_attention: false,
    resolved: false,
    reason: "subscribed",
    following: true,
    ...over,
  } as TomeSummaryItem;
}

const summary = {
  scope: "all",
  counts: { unread: 1, attention: 1 },
  sections: [
    {
      key: "attention",
      items: [item({ id: "a", title: "Unresolved thing", needs_attention: true })],
    },
    {
      key: "team",
      items: [item({ id: "u", title: "A page was written" })],
    },
  ],
  scope_entities: [
    { slug: "example-goal", title: "Example Goal", type: "bhag" },
    {
      slug: "example-area",
      title: "Example Area",
      type: "area",
      parent_slug: "example-goal",
      attention: 1,
    },
  ],
} as unknown as TomeSummary;

const body = {
  data: {
    summary,
    spaces: [
      {
        slug: "example-goal",
        title: "Example Goal",
        type: "bhag",
        page_count: 0,
        last_ingested_at: null,
        last_edited_at: null,
        ingesting: null,
      },
      {
        slug: "example-area",
        title: "Example Area",
        type: "area",
        parent_slug: "example-goal",
        page_count: 3,
        last_ingested_at: null,
        last_edited_at: "2026-10-12T00:00:00.000Z",
        ingesting: null,
      },
    ],
    total: 2,
    withheld: 0,
  },
};

describe("WorkspaceOverview", () => {
  beforeEach(() => {
    window.localStorage.clear();
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(body) }),
    ) as unknown as typeof fetch;
  });

  it("reads everything the reader can see in one request", async () => {
    render(<WorkspaceOverview />);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/tome/overview",
        expect.objectContaining({ cache: "no-store" }),
      ),
    );
  });

  it("shows the four cards that mean something without a single space", async () => {
    render(<WorkspaceOverview />);
    expect(await screen.findByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText("Tagged for you")).toBeInTheDocument();
    expect(screen.getByText("Latest updates")).toBeInTheDocument();
    expect(await screen.findByText("Areas & projects")).toBeInTheDocument();
  });

  it("leaves behind the cards that need one wiki to be about", async () => {
    render(<WorkspaceOverview />);
    await screen.findByText("Needs attention");
    // Asking this space's agent or reading its roadmap has no answer when
    // the space is all of them, and nothing sits above every space.
    expect(screen.queryByText("Ask the agent")).not.toBeInTheDocument();
    expect(screen.queryByText("Milestones")).not.toBeInTheDocument();
    expect(screen.queryByText("At a glance")).not.toBeInTheDocument();
    expect(screen.queryByText("Part of")).not.toBeInTheDocument();
    // A roster is not the answer here either: nobody is a member of a
    // workspace, so the card names who answers for the spaces in it.
    expect(screen.queryByText("Team")).not.toBeInTheDocument();
  });

  it("rolls up what every space reads from, and who answers for it", async () => {
    render(<WorkspaceOverview />);
    expect(await screen.findByText("Sources")).toBeInTheDocument();
    expect(screen.getByText("People")).toBeInTheDocument();
  });

  it("divides the rows between the cards", async () => {
    render(<WorkspaceOverview />);
    expect(await screen.findByText("Unresolved thing")).toBeInTheDocument();
    expect(screen.getByText("A page was written")).toBeInTheDocument();
  });

  it("hands the spaces to the list rather than letting it fetch again", async () => {
    render(<WorkspaceOverview />);
    expect(await screen.findByText("Example Area")).toBeInTheDocument();
    const urls = (global.fetch as jest.Mock).mock.calls.map((call) => call[0]);
    expect(urls.filter((url) => String(url).includes("/children"))).toHaveLength(
      0,
    );
  });

  it("says so when the read does not come back", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.reject() }),
    ) as unknown as typeof fetch;
    render(<WorkspaceOverview />);
    // In each of the three row cards. Saying it once at the top and leaving
    // three empty cards below would read as three different absences.
    expect(await screen.findAllByText("Could not load activity")).toHaveLength(
      3,
    );
  });

  it("offers the arrangement controls", async () => {
    render(<WorkspaceOverview />);
    expect(
      await screen.findByRole("button", { name: /Customize/i }),
    ).toBeInTheDocument();
  });
});
