import { fireEvent, render, screen, within } from "@testing-library/react";

import { SettingsGroupNav } from "@/components/tome/SettingsGroupNav";

const ALL_SOURCES = ["github", "confluence", "webex", "sharepoint", "myagent"];

function setup(
  overrides: Partial<React.ComponentProps<typeof SettingsGroupNav>> = {},
) {
  const onSelect = jest.fn();
  render(
    <SettingsGroupNav
      activeGroup="general"
      activeTab="general"
      activeFocus={null}
      container={false}
      sourceKinds={ALL_SOURCES}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { onSelect };
}

function groupRow() {
  return screen.getByRole("tablist", { name: "Settings sections" });
}

describe("SettingsGroupNav", () => {
  it("shows the five groups rather than every panel at once", () => {
    setup();
    expect(
      within(groupRow())
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["General", "Sources", "Content", "Notifications", "UI preferences"]);
  });

  it("shows the open group's subtabs beneath it", () => {
    setup({ activeGroup: "content", activeTab: "pages" });
    const row = screen.getByRole("tablist", { name: "Content settings" });
    expect(within(row).getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Content",
      "General",
      "Review",
      "Metadata",
    ]);
  });

  // Both rows can carry a tab called General, so a reader is only ever told
  // which one is lit by the row it sits in.
  it("keeps the two tabs named General apart", () => {
    setup({ activeGroup: "content", activeTab: "content-general" });
    const subrow = screen.getByRole("tablist", { name: "Content settings" });
    expect(
      within(subrow).getByRole("tab", { name: "General" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      within(groupRow()).getByRole("tab", { name: "General" }),
    ).toHaveAttribute("aria-selected", "false");
  });

  it("marks the subtab for the panel that is showing", () => {
    setup({ activeGroup: "content", activeTab: "slt" });
    expect(screen.getByRole("tab", { name: "Metadata" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      within(screen.getByRole("tablist", { name: "Content settings" })).getByRole(
        "tab",
        { name: "Content" },
      ),
    ).toHaveAttribute("aria-selected", "false");
  });

  it("tells apart subtabs that share one panel", () => {
    setup({ activeGroup: "sources", activeTab: "sources", activeFocus: "webex" });
    expect(screen.getByRole("tab", { name: "Webex" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "GitHub" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("opens a group on its first subtab", () => {
    const { onSelect } = setup();
    fireEvent.click(within(groupRow()).getByRole("tab", { name: "Sources" }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sources" }),
      expect.objectContaining({ value: "sources", focus: "github" }),
    );
  });

  it("reports both the panel and the part of it a subtab wants", () => {
    const { onSelect } = setup({ activeGroup: "sources", activeTab: "sources" });
    fireEvent.click(screen.getByRole("tab", { name: "SharePoint" }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sources" }),
      expect.objectContaining({ focus: "sharepoint" }),
    );
  });

  it("hides a connector the deployment does not have", () => {
    setup({ activeGroup: "sources", activeTab: "sources", sourceKinds: ["github"] });
    expect(screen.queryByRole("tab", { name: "Confluence" })).toBeNull();
    expect(screen.getByRole("tab", { name: "GitHub" })).toBeInTheDocument();
  });

  it("drops a second row that would offer no choice", () => {
    // A container has no Activity Feed, leaving UI preferences with only
    // Sidebar in it: a row of one is a label pretending to be a control.
    setup({ activeGroup: "ui", activeTab: "reports", container: true });
    expect(
      screen.queryByRole("tablist", { name: "UI preferences settings" }),
    ).toBeNull();
  });

  it("falls back to the first group when asked for one that does not apply", () => {
    setup({ activeGroup: "nonsense", activeTab: "general" });
    expect(
      within(groupRow()).getByRole("tab", { name: "General" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("offers child projects on a container only", () => {
    const { onSelect } = setup({ activeGroup: "general", container: true });
    expect(screen.getByRole("tab", { name: "Projects" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Projects" }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ value: "projects" }),
    );
  });
});
