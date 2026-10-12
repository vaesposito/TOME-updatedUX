import {
  notificationAction,
  type InAppNotificationDocument,
} from "@/types/in-app-notification";

function row(
  overrides: Partial<InAppNotificationDocument> = {},
): Parameters<typeof notificationAction>[0] {
  return { category: "general", ...overrides };
}

describe("notificationAction", () => {
  it("takes the sender's word when they recorded one", () => {
    // Even against phrasing that would otherwise infer the opposite.
    expect(
      notificationAction(row({ action: "new", event_label: "Page updated" })),
    ).toBe("new");
  });

  it.each([
    ["New demo", "new"],
    ["New collateral", "new"],
    ["Decision raised", "new"],
    ["Risk raised", "new"],
    ["Charter published", "new"],
    ["Page updated", "updated"],
    ["Roadmap change", "updated"],
    ["Status update", "updated"],
  ] as const)("reads %s as %s", (label, expected) => {
    expect(notificationAction(row({ event_label: label }))).toBe(expected);
  });

  // "New status update" is news, not a change: the raised wording is checked
  // first precisely so this does not come out as an update.
  it("prefers the raised wording when both appear", () => {
    expect(notificationAction(row({ event_label: "New status update" }))).toBe("new");
  });

  it("treats a settled row as a change to something raised earlier", () => {
    expect(
      notificationAction(row({ event_label: "Decided", lifecycle_status: "resolved" })),
    ).toBe("updated");
  });

  // A health alert has no phrasing of its own. The alert is the new thing,
  // even though what it reports is a service that was already there.
  it("calls an unlabelled alert new", () => {
    expect(notificationAction(row({ category: "platform_health" }))).toBe("new");
  });

  it.each(["status_update", "roadmap_change"] as const)(
    "falls back to updated for %s, which only ever reports a change",
    (category) => {
      expect(notificationAction(row({ category }))).toBe("updated");
    },
  );
});
