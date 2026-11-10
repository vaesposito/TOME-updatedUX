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

import { HubTabs } from "@/components/projects/HubTabs";
import { PageSpaceTags } from "@/components/tome/PageSpaceTags";
import { WebexMeetingSeriesSettings } from "@/components/tome/WebexMeetingSeriesSettings";

/** The element a step with this anchor would be measured against. */
const anchored = (id: string) => document.querySelector(`[data-tour="${id}"]`);

describe("the catalogue's tabs", () => {
  it("are anchored on the tabs, not on what centres them", () => {
    render(<HubTabs value="projects" onChange={jest.fn()} />);

    expect(anchored("hub-tabs")).toBe(screen.getByRole("tablist"));
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
