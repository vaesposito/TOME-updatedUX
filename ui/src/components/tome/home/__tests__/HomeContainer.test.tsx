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

import { HomeChildren } from "../HomeChildren";
import { ProjectHomeView } from "../ProjectHomeView";
import { useTomeHomeWidgetsStore } from "@/store/tome-home-widgets-store";

function item(overrides: Partial<TomeSummaryItem> = {}): TomeSummaryItem {
  return {
    id: "n1",
    title: "Ingest finished",
    message: "",
    category: "update",
    severity: "info",
    event_label: "",
    entity_slug: "example-project",
    entity_title: "Example Project",
    entity_type: "project",
    created_at: "2026-10-10T12:00:00.000Z",
    open_days: 0,
    read: true,
    needs_attention: false,
    resolved: false,
    reason: "in_scope",
    following: false,
    ...overrides,
  };
}

function summary(overrides: Partial<TomeSummary> = {}): TomeSummary {
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
    ...overrides,
  };
}

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
    },
  ],
  total: 5,
  withheld: 3,
};

/** Answer each of Home's requests, so no card is left waiting. */
function serve(
  routes: Record<string, unknown>,
  body: TomeSummary = summary(),
): jest.Mock {
  const fetchMock = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    for (const [fragment, payload] of Object.entries(routes)) {
      if (url.includes(fragment)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: payload }),
        } as Response);
      }
    }
    if (url.includes("/summary")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: body }),
      } as Response);
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  window.localStorage.clear();
  useTomeHomeWidgetsStore.setState({
    layout: { order: [], hidden: [] },
    initialized: false,
    touched: false,
  });
  serve({ "/children": CHILDREN });
});

function home(props: Partial<React.ComponentProps<typeof ProjectHomeView>> = {}) {
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

describe("what the walkthroughs point at", () => {
  // Two tours have a step on Home and both find it by this attribute. A step
  // whose anchor is missing does not fail: it waits, then floats its card
  // into the middle of the screen, which reads as a broken product rather
  // than an absent one. So the anchor is asserted here, where rearranging
  // the page cannot quietly take it away.
  it("keeps the anchor the project-home step lights up", async () => {
    home({ kind: "project" });
    await waitFor(() => expect(widgets()).toContain("glance"));
    const anchor = document.querySelector('[data-tour="project-home"]');
    expect(anchor).not.toBeNull();
    expect(anchor).toContainElement(
      document.querySelector("[data-widget]") as HTMLElement,
    );
  });
});

describe("which cards a kind of space gets", () => {
  it("gives a BHAG and an Area a card for what is below them", async () => {
    for (const kind of ["bhag", "area"] as const) {
      const view = home({ kind });
      await waitFor(() => expect(widgets()).toContain("children"));
      view.unmount();
    }
  });

  it("gives a project no such card, since it has nothing below it", async () => {
    home({ kind: "project" });
    await waitFor(() => expect(widgets()).toContain("glance"));
    expect(widgets()).not.toContain("children");
  });

  it("waits for the kind rather than guessing at it", async () => {
    // Undefined is the entity's own record still being read, which is not
    // the same as a project: a BHAG told to connect a repository, and then
    // told otherwise a moment later, is worse than a card that waits.
    home({ kind: undefined });
    await waitFor(() => expect(widgets()).toContain("sources"));
    expect(screen.queryByText("Nothing connected yet")).not.toBeInTheDocument();
    expect(screen.queryByText("No standup yet")).not.toBeInTheDocument();
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
  });
});

describe("what a container is told to do", () => {
  it("sends a project to connect a source", async () => {
    home({ kind: "project" });
    expect(await screen.findByText("Nothing connected yet")).toBeInTheDocument();
    expect(
      screen.getByText(/A repository, a Confluence space or a Webex room/),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Connect a source" }).length,
    ).toBeGreaterThan(0);
  });

  it("sends a BHAG to synthesize instead, which is its own word for it", async () => {
    home({ kind: "bhag" });
    expect(await screen.findByText("Nothing connected yet")).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing below this reads from a repository/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Connect a source" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Ingest & synthesize" }).length,
    ).toBeGreaterThan(0);
  });

  it("says where a container's standup comes from", async () => {
    home({ kind: "area" });
    expect(await screen.findByText("No standup yet")).toBeInTheDocument();
    expect(
      screen.getByText(/drawing on everything below this/),
    ).toBeInTheDocument();
  });
});

describe("saying the scale of a feed", () => {
  const spread = Array.from({ length: 7 }, (_, index) =>
    item({
      id: `n${index}`,
      entity_slug: index % 2 === 0 ? "example-project" : "example-area",
      created_at: `2026-10-0${index + 1}T12:00:00.000Z`,
    }),
  );

  it("counts the rows and the spaces they came from", async () => {
    serve(
      { "/children": CHILDREN },
      summary({
        sections: [
          {
            key: "team",
            title: "",
            description: "",
            items: spread,
            total: 7,
          },
        ],
      }),
    );
    home({ kind: "bhag" });
    expect(
      await screen.findByText("Showing 5 of 7 across 2 spaces."),
    ).toBeInTheDocument();
  });

  it("does not name the spaces on a project, where there is only one", async () => {
    serve(
      { "/children": CHILDREN },
      summary({
        sections: [
          {
            key: "team",
            title: "",
            description: "",
            items: spread,
            total: 7,
          },
        ],
      }),
    );
    home({ kind: "project" });
    expect(await screen.findByText("Showing 5 of 7.")).toBeInTheDocument();
  });

  it("says nothing when everything fits", async () => {
    serve(
      { "/children": CHILDREN },
      summary({
        sections: [
          {
            key: "team",
            title: "",
            description: "",
            items: spread.slice(0, 3),
            total: 3,
          },
        ],
      }),
    );
    home({ kind: "bhag" });
    await waitFor(() => expect(widgets()).toContain("updates"));
    expect(screen.queryByText(/^Showing /)).not.toBeInTheDocument();
  });
});

describe("the card for what is below", () => {
  const children = (props: Partial<React.ComponentProps<typeof HomeChildren>> = {}) =>
    render(
      <HomeChildren
        slug="example-goal"
        kind="bhag"
        settingsHref="/settings"
        {...props}
      />,
    );

  it("lists each child with how much of it is written and when it last moved", async () => {
    children();
    expect(await screen.findByText("Example Area")).toBeInTheDocument();
    expect(screen.getByText("Example Project")).toBeInTheDocument();
    expect(screen.getByText("4 pages")).toBeInTheDocument();
    expect(screen.getByText("1 page")).toBeInTheDocument();
  });

  it("says which child the agent is reading right now", async () => {
    children();
    expect(await screen.findByText("Ingesting")).toBeInTheDocument();
  });

  it("reaches each child's own home", async () => {
    children();
    expect(
      await screen.findByRole("link", { name: /Example Project/ }),
    ).toHaveAttribute("href", "/projects/example-project/tome");
  });

  it("carries what is waiting in a child over from the digest", async () => {
    children({
      entities: [
        { slug: "example-project", title: "Example Project", type: "project", attention: 2 },
      ],
    });
    expect(await screen.findByText("2 waiting")).toBeInTheDocument();
    expect(screen.getByText("2 things are waiting across 1 of 5.")).toBeInTheDocument();
  });

  it("admits the list is partial rather than understating the portfolio", async () => {
    children();
    expect(
      await screen.findByText("Showing 2 of 5, and 3 not shared with you."),
    ).toBeInTheDocument();
  });

  it("says what fills it when a container has nothing below it yet", async () => {
    serve({ "/children": { children: [], total: 0, withheld: 0 } });
    children();
    expect(await screen.findByText("Nothing below this yet")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open settings" }),
    ).toHaveAttribute("href", "/settings");
  });

  it("offers a retry rather than an empty list when the request fails", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response),
    ) as unknown as typeof fetch;
    children();
    expect(
      await screen.findByText("Could not load what's below"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
