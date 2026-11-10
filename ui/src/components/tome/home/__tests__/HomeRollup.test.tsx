/** @jest-environment jsdom */

/**
 * An overview read at the altitude it is actually at.
 *
 * A BHAG or an Area connects almost nothing itself and nobody is a member of
 * a goal, so the cards that answer "where does this read from" and "who
 * answers for it" have to roll up the spaces below or they describe an empty
 * container over a full portfolio. These are the three cards that change with
 * altitude: Sources, People, and the one that looks up rather than down.
 */

import { render, screen, waitFor } from "@testing-library/react";
import * as React from "react";

import type { TomeSummary } from "@/types/tome-summary";

jest.mock("@/lib/api-client", () => ({
  apiClient: {
    getSettings: () => Promise.resolve({ preferences: {} }),
    updatePreferences: () => Promise.resolve({}),
  },
}));

jest.mock("@/components/shared/timeline/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
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

jest.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

import { ProjectHomeView } from "../ProjectHomeView";
import { useTomeHomeWidgetsStore } from "@/store/tome-home-widgets-store";

function summary(): TomeSummary {
  return {
    entity: { slug: "example-goal", title: "Example Goal", type: "bhag" },
    scope_entities: [],
    scope: "all",
    headline: "",
    counts: {
      attention: 0,
      decided: 0,
      open_decisions: 0,
      team: 0,
      elsewhere: 0,
      wiki: 0,
      descendants: 0,
      recently_resolved: 0,
      unread: 0,
    },
    sections: [],
    since: "2026-09-10T00:00:00.000Z",
    generated_at: "2026-10-10T12:00:00.000Z",
  };
}

/**
 * Two spaces below, between them every shape a roll-up has to cope with: a
 * source the two of them share, a steward who is also an owner elsewhere, and
 * a space with no steward at all.
 */
const CHILDREN = {
  children: [
    {
      slug: "example-area",
      title: "Example Area",
      type: "area" as const,
      page_count: 4,
      last_ingested_at: "2026-10-10T09:00:00.000Z",
      last_edited_at: null,
      ingesting: null,
      sources: { repos: ["example-org/primary", "example-org/shared"] },
      steward: "first@example.com",
      owner: "second@example.com",
      team: { slug: "example-team", name: "Example Team" },
    },
    {
      slug: "example-project",
      title: "Example Project",
      type: "project" as const,
      parent_slug: "example-area",
      page_count: 1,
      last_ingested_at: null,
      last_edited_at: null,
      ingesting: "running" as const,
      sources: {
        repos: ["example-org/shared"],
        webex_rooms: [{ room_id: "room-1", name: "Example Room" }],
      },
      owner: "first@example.com",
    },
  ],
  total: 2,
  withheld: 0,
};

const ANCESTORS = [
  { href: "/projects/example-goal/tome", title: "Example Goal", type: "bhag" as const },
  { href: "/projects/example-area/tome", title: "Example Area", type: "area" as const },
];

/** The same card for a space on the function axis rather than the hierarchy. */
const SUBJECT_ANCESTORS = [
  { href: "/projects?tab=functions", title: "Example Function", type: "function" as const },
  {
    href: "/projects/functions/example-function--example-function-example-category",
    title: "Example Category",
    type: "category" as const,
  },
];

function serve(children: unknown = CHILDREN): void {
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/children")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: children }),
      } as Response);
    }
    if (url.includes("/summary")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: summary() }),
      } as Response);
    }
    return Promise.resolve({
      ok: false,
      json: () => Promise.resolve({}),
    } as Response);
  }) as unknown as typeof fetch;
}

function home(
  props: Partial<React.ComponentProps<typeof ProjectHomeView>> = {},
) {
  return render(
    <ProjectHomeView
      slug="example-goal"
      title="Example Goal"
      pages={{}}
      sources={null}
      onAsk={() => {}}
      {...props}
    />,
  );
}

const widgets = () =>
  Array.from(document.querySelectorAll("[data-widget]")).map((node) =>
    node.getAttribute("data-widget"),
  );

beforeEach(() => {
  window.localStorage.clear();
  useTomeHomeWidgetsStore.setState({
    layout: { order: [], hidden: [] },
    initialized: false,
    touched: false,
  });
  serve();
});

describe("where a container's knowledge comes from", () => {
  it("counts the sources on the spaces below it", async () => {
    home({ kind: "bhag" });
    // Two repositories, not three: the one both spaces mirror is one source
    // to read, and counting it twice would overstate the portfolio.
    expect(await screen.findByText("Example Room")).toBeInTheDocument();
    expect(screen.getByText("example-org/primary")).toBeInTheDocument();
    expect(
      screen.getAllByText("example-org/shared").length,
    ).toBe(1);
  });

  it("says how many spaces they came from, and when they were last read", async () => {
    home({ kind: "bhag" });
    expect(
      await screen.findByText(/From 2 spaces, last ingest/),
    ).toBeInTheDocument();
  });

  it("says nothing of the sort on a project, where every source is its own", async () => {
    home({ kind: "project", sources: { repos: ["example-org/primary"] } });
    expect(
      await screen.findByText("example-org/primary"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/From 1 space/)).not.toBeInTheDocument();
  });

  it("reports an empty portfolio rather than an empty container", async () => {
    serve({ children: [], total: 0, withheld: 0 });
    home({ kind: "bhag" });
    expect(
      await screen.findByText("Nothing connected yet"),
    ).toBeInTheDocument();
  });
});

describe("who answers for a container", () => {
  it("names the stewards and owners across the spaces below", async () => {
    home({ kind: "bhag" });
    expect(await screen.findByText("Example Team")).toBeInTheDocument();
    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByText("second@example.com")).toBeInTheDocument();
  });

  it("names a person once, at the strongest claim they have", async () => {
    home({ kind: "bhag" });
    // Steward of one space and owner of another is a steward: that is the
    // role that decides who may change anything.
    expect(await screen.findByText("first@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("first@example.com").length).toBe(1);
    expect(screen.getAllByText("steward").length).toBe(1);
  });

  it("keeps the roster on a project, where a roster is the answer", async () => {
    home({ kind: "project" });
    await waitFor(() => expect(widgets()).toContain("team"));
    expect(screen.queryByText("People")).not.toBeInTheDocument();
  });
});

describe("what a space belongs to", () => {
  it("names the goal and the area above a project", async () => {
    home({ kind: "project", ancestors: ANCESTORS });
    expect(await screen.findByText("Part of")).toBeInTheDocument();
    expect(screen.getByText("Example Goal")).toBeInTheDocument();
    expect(screen.getByText("Example Area")).toBeInTheDocument();
  });

  it("names the function and the category above a subject", async () => {
    home({ kind: "project", ancestors: SUBJECT_ANCESTORS });
    expect(await screen.findByText("Part of")).toBeInTheDocument();
    // The function axis read in the function axis's own words, and pointing
    // at the function view rather than at a space.
    expect(screen.getByText("Function")).toBeInTheDocument();
    expect(screen.getByText("Category")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Example Function/ })).toHaveAttribute(
      "href",
      "/projects?tab=functions",
    );
  });

  it("offers a way to say so when nothing is named yet", async () => {
    home({ kind: "project", ancestors: [] });
    expect(
      await screen.findByText("Not part of anything yet"),
    ).toBeInTheDocument();
  });

  it("leaves the card out at the top of the tree", async () => {
    home({ kind: "bhag", ancestors: [] });
    await waitFor(() => expect(widgets()).toContain("children"));
    expect(widgets()).not.toContain("partof");
    expect(screen.queryByText("Part of")).not.toBeInTheDocument();
  });

  it("waits for the trail rather than denying there is one", async () => {
    home({ kind: "project" });
    await waitFor(() => expect(widgets()).toContain("partof"));
    expect(
      screen.queryByText("Not part of anything yet"),
    ).not.toBeInTheDocument();
  });
});
