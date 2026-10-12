/** @jest-environment jsdom */

import { render, screen, within } from "@testing-library/react";

import { NotificationRow } from "../NotificationRow";
import {
  groupByAction,
  groupByOrigin,
  notificationOrigin,
  notificationType,
} from "../notification-presentation";
import {
  TOME_NOTIFICATION_CATEGORIES,
  type InAppNotificationView,
} from "@/types/in-app-notification";

/** Comfortably past the one-week window, whenever the suite runs. */
const WEEKS_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

function notification(
  overrides: Partial<InAppNotificationView> = {},
): InAppNotificationView {
  return {
    id: "row",
    title: "Something happened",
    message: "A line of detail",
    category: "collateral",
    severity: "info",
    created_at: new Date().toISOString(),
    read: false,
    dismissed: false,
    needs_attention: false,
    following: false,
    ...overrides,
  } as InAppNotificationView;
}

function show(
  overrides: Partial<InAppNotificationView> = {},
  handlers: { onDismiss?: () => void; onRestore?: () => void } = {},
) {
  return render(
    <ul>
      <NotificationRow
        notification={notification(overrides)}
        selected={false}
        onSelectedChange={() => {}}
        {...handlers}
      />
    </ul>,
  );
}

describe("notificationOrigin", () => {
  // The inbox's label has to agree with the "TOME notifications" toggle:
  // a row badged TOME that survived turning TOME off would be a lie.
  it.each(TOME_NOTIFICATION_CATEGORIES)("calls %s a TOME row", (category) => {
    expect(notificationOrigin({ category })).toBe("TOME");
  });

  it.each(["platform_health", "general"] as const)(
    "calls %s part of the wider platform",
    (category) => {
      expect(notificationOrigin({ category })).toBe("Platform");
    },
  );
});

describe("NotificationRow", () => {
  // The complaint this answers: scanning the inbox gave no way to tell which
  // rows came from TOME and which from the rest of the platform.
  it("says a wiki row came from TOME", () => {
    show({ category: "collateral", entity_title: "Skills Catalog" });

    expect(screen.getByText("TOME")).toBeInTheDocument();
  });

  it("says a health row came from the platform", () => {
    show({ category: "platform_health", title: "Chat Runtime is unavailable" });

    expect(screen.getByText("Platform")).toBeInTheDocument();
  });

  // A health row has no wording of its own, so its type name is the word
  // already in the tag.
  it("does not print the platform twice", () => {
    show({ category: "platform_health" });

    expect(screen.getAllByText("Platform")).toHaveLength(1);
  });

  // The order the reader was promised: where it came from, what happened,
  // which project.
  it("keeps the type and entity alongside the tag", () => {
    const { container } = show({
      category: "decision",
      action: "updated",
      entity_title: "Agent Gateway Hardening",
    });

    const meta = within(container).getByText("TOME").closest("p")!;
    expect(meta.textContent).toBe("TOMEUpdated · Agent Gateway Hardening");
  });

  it("calls a row addressed to the reader Tagged", () => {
    show({ action: "new", mentioned: true });

    expect(screen.getByText("Tagged")).toBeInTheDocument();
    expect(screen.queryByText("New")).not.toBeInTheDocument();
  });

  // A tagged row's detail line is a person talking to the reader, so it is
  // quoted rather than presented as the system describing itself.
  it("quotes the message when someone was tagged", () => {
    show({
      mentioned: true,
      title: "Priya tagged you in Charter",
      message: "please verify the auth section",
    });

    expect(
      screen.getByText("\u201Cplease verify the auth section\u201D"),
    ).toBeInTheDocument();
  });

  it("names the author on an untagged row", () => {
    show({ mentioned: false, title: "Charter updated", actor_name: "Dana Okafor" });

    expect(screen.getByText("By Dana Okafor")).toBeInTheDocument();
  });

  // Senders wrote this line by hand and it came out as a different fact on
  // every row. Only the author earns the space now.
  it("drops a hand-written line in favour of the author", () => {
    show({
      mentioned: false,
      title: "This week in Developer Experience",
      message: "3 projects reported · 2 decisions settled · 1 slip",
      actor_name: "Dana Okafor",
    });

    expect(screen.getByText("By Dana Okafor")).toBeInTheDocument();
    expect(screen.queryByText(/projects reported/)).not.toBeInTheDocument();
  });

  it("says nothing when the platform raised it and no one authored it", () => {
    show({
      mentioned: false,
      title: "This week in Developer Experience",
      message: "3 projects reported · 2 decisions settled · 1 slip",
    });

    expect(screen.queryByText(/projects reported/)).not.toBeInTheDocument();
  });

  // A tagged row is the exception: those words are someone writing to this
  // reader, and the author's name does not replace them.
  it("keeps a tagged message even when the author is known", () => {
    show({
      mentioned: true,
      title: "Priya tagged you in Charter",
      message: "please verify the auth section",
      actor_name: "Priya Raman",
    });

    expect(
      screen.getByText("\u201Cplease verify the auth section\u201D"),
    ).toBeInTheDocument();
    expect(screen.queryByText("By Priya Raman")).not.toBeInTheDocument();
  });
});

describe("row content", () => {
  it("carries a title, an author, a timestamp and a link to the artifact", () => {
    show({
      title: "Charter updated",
      actor_name: "Sam Whitfield",
      href: "/projects/agent-gateway/tome/wiki/charter",
    });

    expect(screen.getByText("Charter updated")).toBeInTheDocument();
    expect(screen.getByText("By Sam Whitfield")).toBeInTheDocument();
    expect(screen.getByText(/ago|now|^\d/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open/ })).toHaveAttribute(
      "href",
      "/projects/agent-gateway/tome/wiki/charter",
    );
  });

  // Senders sometimes pass the title through as the message, and a tagged
  // row is the one place a message still shows.
  it("does not print the title twice", () => {
    show({ mentioned: true, title: "Charter updated", message: "Charter updated" });

    expect(screen.getAllByText("Charter updated")).toHaveLength(1);
  });

  // The only target is the entity's own landing page, so this is navigation
  // rather than opening the artifact, and the label says so.
  it("is honest when the target is only the entity", () => {
    show({
      entity_slug: "agent-gateway",
      entity_title: "Agent Gateway Hardening",
      href: "/projects/agent-gateway/tome",
    });

    expect(screen.queryByRole("link", { name: /^Open/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to Agent Gateway Hardening" }),
    ).toBeInTheDocument();
  });
});

describe("row actions", () => {
  // Watching is a standing choice about an entity, not a response to one
  // notification; a row offers Dismiss and nothing else.
  it("offers Dismiss alone", () => {
    show({ entity_slug: "agent-gateway" }, { onDismiss: () => {} });

    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Watch/ }),
    ).not.toBeInTheDocument();
  });

  // Restore is the inverse of Dismiss, not a second action: without it a
  // dismissal could not be undone.
  it("swaps Dismiss for Restore once dismissed", () => {
    show({ dismissed: true }, { onDismiss: () => {}, onRestore: () => {} });

    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });
});

describe("groupByOrigin", () => {
  it("splits the list in two", () => {
    const groups = groupByOrigin([
      notification({ id: "a", category: "decision" }),
      notification({ id: "b", category: "platform_health" }),
      notification({ id: "c", category: "collateral" }),
    ]);

    expect(groups.map((group) => group.group)).toEqual(["TOME", "Platform"]);
    expect(groups[0].items.map((item) => item.id)).toEqual(["a", "c"]);
    expect(groups[1].items.map((item) => item.id)).toEqual(["b"]);
  });

  // TOME is the reader's own work; a quiet week for it should not push it
  // below platform news.
  it("keeps TOME first even when it is the smaller half", () => {
    const groups = groupByOrigin([
      notification({ id: "a", category: "platform_health" }),
      notification({ id: "b", category: "general" }),
      notification({ id: "c", category: "decision" }),
    ]);

    expect(groups[0].group).toBe("TOME");
  });

  it("omits a half with nothing in it", () => {
    const groups = groupByOrigin([notification({ category: "decision" })]);

    expect(groups.map((group) => group.group)).toEqual(["TOME"]);
  });

  it("returns nothing for an empty list", () => {
    expect(groupByOrigin([])).toEqual([]);
  });
});

describe("groupByAction", () => {
  it("splits the list by what happened, in the filter's own order", () => {
    const groups = groupByAction([
      notification({ id: "a", action: "updated" }),
      notification({ id: "b", action: "new" }),
      notification({ id: "c", action: "updated" }),
    ]);

    expect(groups.map((group) => group.group)).toEqual(["New", "Updated"]);
    expect(groups[1].items.map((item) => item.id)).toEqual(["a", "c"]);
  });

  // Rows written before the field existed still have to land somewhere.
  it("infers an action when none was recorded", () => {
    const groups = groupByAction([
      notification({ action: undefined, event_label: "Status update" }),
    ]);

    expect(groups.map((group) => group.group)).toEqual(["Updated"]);
  });

  it("omits an action with nothing in it", () => {
    const groups = groupByAction([notification({ action: "new" })]);

    expect(groups.map((group) => group.group)).toEqual(["New"]);
  });

  // Tagged is what the reader scans for, so it heads the list rather than
  // being scattered through New and Updated.
  it("puts tagged ahead of new and updated", () => {
    const groups = groupByAction([
      notification({ id: "a", action: "updated" }),
      notification({ id: "b", action: "new", mentioned: true }),
      notification({ id: "c", action: "new" }),
    ]);

    expect(groups.map((group) => group.group)).toEqual([
      "Tagged",
      "New",
      "Updated",
    ]);
    expect(groups[0].items.map((item) => item.id)).toEqual(["b"]);
    expect(groups[1].items.map((item) => item.id)).toEqual(["c"]);
  });

  it("stops calling something new once the week is up", () => {
    const groups = groupByAction([
      notification({ id: "old", action: "new", created_at: WEEKS_AGO }),
    ]);

    expect(groups.map((group) => group.group)).toEqual(["Updated"]);
  });
});

describe("notificationType", () => {
  it("calls a recent arrival new", () => {
    expect(notificationType(notification({ action: "new" }))).toBe("New");
  });

  // "New" is a claim about now, so it expires; the stored action does not.
  it("calls an old arrival updated", () => {
    expect(
      notificationType(notification({ action: "new", created_at: WEEKS_AGO })),
    ).toBe("Updated");
  });

  it("calls a tagged row tagged however old it is", () => {
    expect(
      notificationType(
        notification({ action: "new", created_at: WEEKS_AGO, mentioned: true }),
      ),
    ).toBe("Tagged");
  });
});
