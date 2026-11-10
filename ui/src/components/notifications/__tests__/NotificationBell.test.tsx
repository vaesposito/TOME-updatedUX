/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/store/unsaved-changes-store", () => ({
  useUnsavedChangesStore: () => ({
    hasUnsavedChanges: false,
    requestNavigation: jest.fn(),
  }),
}));

import { NotificationBell } from "../NotificationBell";

// The bell remembers folded sections, so one test must not arrive with the
// previous test's sections already collapsed.
beforeEach(() => window.localStorage.clear());

it("shows a friendly empty state",async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      notifications: [],
      unread_count: 0,
      pagination: { page: 1,page_size: 10,total: 0,total_pages: 1 },
    }),
  })) as jest.Mock;

  render(<NotificationBell enabled />);
  fireEvent.click(await screen.findByRole("button",{ name: "Notifications" }));

  expect(await screen.findByText("You’re all caught up ✅")).toBeInTheDocument();
  expect(screen.getByText("No notifications yet... but why not try to change that?"))
    .toBeInTheDocument();
});

it("shows unread approval outcomes and marks one read when opened", async () => {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/notifications?")) {
      return {
        ok: true,
        json: async () => ({
          notifications: [{
            id: "notification-primary",
            title: "Request rejected",
            message: "Slack: #primary was rejected by Review Admin.",
            href: "/admin?cat=security&tab=approvals&view=history",
            severity: "error",
            created_at: "2026-01-01T00:00:00.000Z",
            read: false,
          }],
          unread_count: 1,
          pagination: { page: 1, page_size: 10, total: 1, total_pages: 1 },
        }),
      } as Response;
    }
    return { ok: true, json: async () => ({ read: true }) } as Response;
  });
  global.fetch = fetchMock;

  render(<NotificationBell enabled />);

  const trigger = await screen.findByRole("button", {
    name: "1 unread notifications",
  });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByText("Request rejected"));

  expect(mockPush).toHaveBeenCalledWith(
    "/admin/security/approvals?view=history",
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    "/api/notifications/notification-primary",
    expect.objectContaining({ method: "PATCH" }),
  ));
});

function groupedResponse() {
  const groups = [
      {
        key: "tome",
        unread_count: 2,
        total: 5,
        notifications: [{
          id: "tome-1",
          title: "Define messaging plan for October",
          message: "SLT buy-in due Oct 1",
          entity_title: "Developer Experience",
          severity: "info",
          category: "due",
          source_label: "TOME",
          created_at: "2026-10-08T12:00:00.000Z",
          read: false,
        }],
      },
      {
        key: "platform",
        unread_count: 1,
        total: 1,
        notifications: [{
          id: "platform-1",
          title: "Chat Runtime is unavailable",
          message: "Chat runtime health check is unreachable",
          severity: "error",
          category: "platform_health",
          source_label: "Platform",
          created_at: "2026-10-08T12:00:00.000Z",
          read: false,
        }],
      },
  ];
  // The API returns the concatenation alongside the groups.
  return {
    notifications: groups.flatMap((group) => group.notifications),
    unread_count: 3,
    pagination: { page: 1, page_size: 6, total: 6, total_pages: 1 },
    groups,
  };
}

it("separates Tome notifications from platform ones and folds a section away", async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => groupedResponse(),
  })) as jest.Mock;

  render(<NotificationBell enabled />);
  fireEvent.click(await screen.findByRole("button", { name: "3 unread notifications" }));

  // Section headers are the only buttons that expand; rows never do. The
  // uppercasing is presentational, so the accessible name is title case.
  const tome = await screen.findByRole("button", { name: /^tome/i, expanded: true });
  expect(
    screen.getByRole("button", { name: /^platform/i, expanded: true }),
  ).toBeInTheDocument();
  // Four of the group's five rows are not shown, and the header says so.
  expect(screen.getByText("+4 more")).toBeInTheDocument();
  expect(screen.getByText("Define messaging plan for October")).toBeInTheDocument();

  fireEvent.click(tome);

  expect(tome).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("Define messaging plan for October")).not.toBeInTheDocument();
  // Folding a section must not hide that it still needs attention.
  expect(screen.getByText("2")).toBeInTheDocument();
  // The other section is untouched.
  expect(screen.getByText("Chat Runtime is unavailable")).toBeInTheDocument();
});

it("stays a flat list when only one group has anything in it", async () => {
  const body = groupedResponse();
  body.groups[1].notifications = [];
  body.groups[1].total = 0;
  body.groups[1].unread_count = 0;
  body.notifications = body.groups[0].notifications;
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => body })) as jest.Mock;

  render(<NotificationBell enabled />);
  fireEvent.click(await screen.findByRole("button", { name: "3 unread notifications" }));

  expect(await screen.findByText("Define messaging plan for October")).toBeInTheDocument();
  // Within the list, since the bell that opened it is itself something that
  // expands. Nothing in the list is: one group needs no headers to fold.
  const list = within(
    screen.getByText("Define messaging plan for October").closest("[data-popover-content]")!,
  );
  expect(list.queryByRole("button", { expanded: true })).not.toBeInTheDocument();
  expect(list.queryByRole("button", { expanded: false })).not.toBeInTheDocument();
});

it("labels global platform incidents and their resolved lifecycle",async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      notifications: [{
        id: "platform-primary",
        title: "Chat Runtime recovered",
        message: "A platform health audit confirmed recovery.",
        href: "/admin/operations/health",
        severity: "success",
        category: "platform_health",
        source_label: "Platform",
        lifecycle_status: "resolved",
        created_at: "2026-08-20T10:00:00.000Z",
        read: true,
      }],
      unread_count: 0,
      pagination: { page: 1,page_size: 10,total: 1,total_pages: 1 },
    }),
  })) as jest.Mock;

  render(<NotificationBell enabled />);
  fireEvent.click(await screen.findByRole("button",{ name: "Notifications" }));

  expect(await screen.findByText("Platform")).toBeInTheDocument();
  expect(screen.getByText("Resolved")).toBeInTheDocument();
});
