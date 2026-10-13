/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";

import {
  DEFAULT_TOME_HOME_LAYOUT,
  type TomeHomeLayout,
} from "@/lib/tome/home-widgets";

const mockUpdatePreferences = jest.fn(() => Promise.resolve({}));
const mockGetSettings = jest.fn(() => Promise.resolve({ preferences: {} }));

jest.mock("@/lib/api-client", () => ({
  apiClient: {
    getSettings: () => mockGetSettings(),
    updatePreferences: (body: unknown) => mockUpdatePreferences(body),
  },
}));

// The renderer pulls in a syntax highlighter and its ESM dependencies, none
// of which this suite has an opinion about — the cards under test here are
// being counted and moved, not read.
jest.mock("@/components/shared/timeline/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

// dnd-kit does not do pointer geometry under jsdom, so the context is stubbed
// and the drag handler captured — the same approach the main home page's
// suite takes. What is under test is what the page does with a finished
// drag, which is the part that is ours.
let onDragEnd:
  | ((event: { active: { id: string }; over: { id: string } | null }) => void)
  | null = null;

jest.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragEnd: handler,
  }: {
    children: React.ReactNode;
    onDragEnd: typeof onDragEnd;
  }) => {
    onDragEnd = handler;
    return <>{children}</>;
  },
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

/** The cards on show, in the order the page put them. */
function cardOrder(): string[] {
  return Array.from(document.querySelectorAll("[data-widget]")).map(
    (node) => node.getAttribute("data-widget") ?? "",
  );
}

function home() {
  return render(
    <ProjectHomeView
      slug="example-project"
      title="Example Project"
      pages={{}}
      sources={null}
      onAsk={() => {}}
    />,
  );
}

function savedLayout(): TomeHomeLayout | undefined {
  const last = mockUpdatePreferences.mock.calls.at(-1)?.[0] as
    | { tome_home_widgets?: TomeHomeLayout }
    | undefined;
  return last?.tome_home_widgets;
}

describe("arranging a project's home page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockUpdatePreferences.mockClear();
    mockGetSettings.mockClear();
    mockGetSettings.mockResolvedValue({ preferences: {} });
    useTomeHomeWidgetsStore.setState({
      layout: DEFAULT_TOME_HOME_LAYOUT,
      initialized: false,
      touched: false,
    });
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve({ ok: false, status: 500, json: async () => ({}) }),
    );
  });

  it("offers to customize, and says nothing else until asked", () => {
    home();
    expect(screen.getByRole("button", { name: /Customize/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide Team" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move Team" })).not.toBeInTheDocument();
  });

  it("shows a handle and a hide control on every card once arranging", () => {
    home();
    fireEvent.click(screen.getByRole("button", { name: /Customize/ }));
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    for (const label of ["Ask the agent", "Needs attention", "Team", "KPIs"]) {
      expect(screen.getByRole("button", { name: `Move ${label}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Hide ${label}` })).toBeInTheDocument();
    }
  });

  it("puts a card away, and offers it back by name", async () => {
    home();
    fireEvent.click(screen.getByRole("button", { name: /Customize/ }));
    expect(cardOrder()).toContain("kpis");

    fireEvent.click(screen.getByRole("button", { name: "Hide KPIs" }));
    expect(cardOrder()).not.toContain("kpis");

    const restore = screen.getByRole("button", { name: "KPIs" });
    await waitFor(() => expect(savedLayout()?.hidden).toEqual(["kpis"]));

    fireEvent.click(restore);
    expect(cardOrder()).toContain("kpis");
    await waitFor(() => expect(savedLayout()?.hidden).toEqual([]));
  });

  it("counts what is put away where a reader will go looking for it", () => {
    home();
    fireEvent.click(screen.getByRole("button", { name: /Customize/ }));
    fireEvent.click(screen.getByRole("button", { name: "Hide KPIs" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide Team" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: /2 hidden/ })).toBeInTheDocument();
  });

  it("keeps the new order after a drag, and saves it", async () => {
    home();
    const before = cardOrder();
    onDragEnd?.({ active: { id: "kpis" }, over: { id: before[0] } });
    await waitFor(() => expect(cardOrder()[0]).toBe("kpis"));
    expect(savedLayout()?.order[0]).toBe("kpis");
  });

  it("ignores a drag that ended on nothing", () => {
    home();
    const before = cardOrder();
    onDragEnd?.({ active: { id: "kpis" }, over: null });
    expect(cardOrder()).toEqual(before);
    expect(mockUpdatePreferences).not.toHaveBeenCalled();
  });

  it("offers Reset only once there is an arrangement to undo", () => {
    home();
    fireEvent.click(screen.getByRole("button", { name: /Customize/ }));
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide Team" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(cardOrder()).toContain("team");
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
  });

  it("leaves arranging when it is done, and keeps the arrangement", () => {
    home();
    fireEvent.click(screen.getByRole("button", { name: /Customize/ }));
    fireEvent.click(screen.getByRole("button", { name: "Hide Sources" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("button", { name: "Move Team" })).not.toBeInTheDocument();
    expect(cardOrder()).not.toContain("sources");
  });

  it("reads an arrangement saved on the account", async () => {
    mockGetSettings.mockResolvedValue({
      preferences: { tome_home_widgets: { order: [], hidden: ["glance"] } },
    });
    home();
    await waitFor(() => expect(cardOrder()).not.toContain("glance"));
  });

  it("keeps what this browser last chose over a save that never landed", async () => {
    // The arrangement is on this machine, but the account still has the page
    // as it ships: the save was dropped. Adopting the account's copy would
    // undo the reader's own change in front of them.
    window.localStorage.setItem(
      "caipe-tome-home-widgets",
      JSON.stringify({ order: [], hidden: ["kpis"] }),
    );
    mockGetSettings.mockResolvedValue({ preferences: {} });
    home();
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
    expect(cardOrder()).not.toContain("kpis");
    // And it repairs itself rather than waiting to be noticed.
    await waitFor(() => expect(savedLayout()?.hidden).toEqual(["kpis"]));
  });

  it("does not keep re-saving a browser that already agrees with the account", async () => {
    const layout = { order: [], hidden: ["kpis"] };
    window.localStorage.setItem("caipe-tome-home-widgets", JSON.stringify(layout));
    mockGetSettings.mockResolvedValue({
      preferences: { tome_home_widgets: layout },
    });
    home();
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
    expect(mockUpdatePreferences).not.toHaveBeenCalled();
  });

  it("keeps the reader's own change over one arriving from the account", async () => {
    let settle: (value: { preferences: Record<string, unknown> }) => void = () => {};
    mockGetSettings.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    home();
    fireEvent.click(screen.getByRole("button", { name: /Customize/ }));
    fireEvent.click(screen.getByRole("button", { name: "Hide KPIs" }));

    settle({ preferences: { tome_home_widgets: { order: [], hidden: ["team"] } } });
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
    expect(cardOrder()).not.toContain("kpis");
    expect(cardOrder()).toContain("team");
  });
});
