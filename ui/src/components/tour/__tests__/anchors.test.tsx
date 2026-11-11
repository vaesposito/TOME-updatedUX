/** @jest-environment jsdom */

/**
 * Where the walkthrough's anchors sit.
 *
 * A step rings the element carrying its `data-tour`, so however well the
 * runner measures, an attribute left on the wrapper that centres a control,
 * or on the row a control shares with everything already made, points the
 * reader at the wrong thing. Each of these was one of those.
 */

import { render, screen } from "@testing-library/react";

import { FunctionsView } from "@/components/projects/FunctionsView";
import { HubTabs } from "@/components/projects/HubTabs";
import { PageSpaceTags } from "@/components/tome/PageSpaceTags";
import { PanelShell } from "@/components/tome/PanelHeader";
import { NavSection } from "@/components/tome/RailNav";
import { TomeEmpty } from "@/components/tome/TomeEmpty";
import { WebexMeetingSeriesSettings } from "@/components/tome/WebexMeetingSeriesSettings";
import { WorkspaceDigest } from "@/components/tome/WorkspaceDigest";

/** The element a step with this anchor would be measured against. */
const anchored = (id: string) => document.querySelector(`[data-tour="${id}"]`);

describe("the catalogue's tabs", () => {
  it("are anchored on the tabs, not on what centres them", () => {
    render(<HubTabs value="projects" onChange={jest.fn()} />);

    expect(anchored("hub-tabs")).toBe(screen.getByRole("tablist"));
  });

  it("each carry their own anchor, so a step can ring one of them", () => {
    render(<HubTabs value="projects" onChange={jest.fn()} />);

    expect(anchored("hub-tab-projects")).toBe(
      screen.getByRole("tab", { name: /By project/ }),
    );
  });
});

describe("what a subject is", () => {
  it("is anchored on the control that names one, not on the axis", () => {
    // The function axis has no tab of its own for a subject: the step about
    // what one is points at the only control that says the word, which is
    // also the only part of the view a deployment with no subjects still has.
    render(<FunctionsView subjects={[]} />);

    expect(anchored("hub-add-subject")).toBe(
      screen.getByRole("button", { name: /Add subject/ }),
    );
  });
});

describe("the digest", () => {
  it("is anchored on what configures it, not on the prose it writes", () => {
    render(<WorkspaceDigest />);

    const control = screen.getByRole("button", { name: /Configure digest/ });
    expect(anchored("hub-digest-configure")).toBe(control);
    // The digest itself is a page tall, and a ring drawn round it would be
    // bigger than the window.
    expect(anchored("hub-digest-configure")).not.toContainElement(
      screen.getByRole("heading", { name: "Digest" }),
    );
  });
});

describe("connecting a page to a space", () => {
  const spaces = [{ slug: "example-space", title: "Example space" }];

  it("is anchored on the control that makes the connection", () => {
    render(
      <PageSpaceTags
        tags={["example-space"]}
        spaces={spaces}
        editing
        onChange={jest.fn()}
      />,
    );

    expect(anchored("page-tags")).toBe(
      screen.getByRole("button", { name: /Connect to a space/ }),
    );
  });

  it("has nothing to point at while the page is being read", () => {
    // Which is what the step's waiting hint is for: the connections already
    // made are shown to a reader, but making one is something only the
    // editor offers, so the step says to choose Edit rather than ringing
    // the row of tags.
    render(
      <PageSpaceTags
        tags={["example-space"]}
        spaces={spaces}
        editing={false}
        onChange={jest.fn()}
      />,
    );

    expect(anchored("page-tags")).toBeNull();
  });
});

describe("the far end of a connection", () => {
  it("is anchored on the rail's own row, not on the column it heads", () => {
    // Expanded, the section is the whole rail: a ring drawn round the column
    // would take in every page under it as well as the row being named.
    render(
      <NavSection
        icon={null}
        label="Related content"
        active={false}
        expanded
        count={2}
        onToggle={jest.fn()}
        onClick={jest.fn()}
        controlsId="related"
        anchor="space-related"
      >
        <span>A page from somewhere else</span>
      </NavSection>,
    );

    expect(anchored("space-related")).toBe(
      screen.getByRole("button", { name: "Related content" }),
    );
    expect(anchored("space-related")).not.toContainElement(
      screen.getByText("A page from somewhere else"),
    );
  });

  it("is anchored on the view, so an empty one can still be rung", () => {
    // The list is swapped for an empty state whenever nothing tags the
    // space, and a step anchored on the list would have nothing to point at
    // in exactly the deployment where it most has something to say.
    render(
      <PanelShell title="Related content" anchor="space-related-list">
        <TomeEmpty headline="No page tags this space yet" />
      </PanelShell>,
    );

    expect(anchored("space-related-list")).toContainElement(
      screen.getByText("No page tags this space yet"),
    );
  });
});

describe("the Webex section of a project's settings", () => {
  it("is anchored on what the section is for, not on the list it grows", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { subscriptions: [], occurrences: [] },
      }),
    }) as unknown as typeof fetch;

    render(<WebexMeetingSeriesSettings slug="example-project" canEdit />);

    const empty = await screen.findByText(/No recurring meetings selected/);
    expect(anchored("webex-settings")).toContainElement(
      screen.getByRole("button", { name: /Add series/ }),
    );
    // Every attached series sits below the ring rather than inside it, so
    // the spotlight stays the size of the thing being named.
    expect(anchored("webex-settings")).not.toContainElement(empty);
  });
});
