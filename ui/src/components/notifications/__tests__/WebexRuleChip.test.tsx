/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import { WebexRuleChip } from "../WebexRuleChip";
import type { WebexDeliveryState } from "../useWebexDelivery";
import type { WebexDeliveryRule } from "@/types/webex-delivery";

function rule(overrides: Partial<WebexDeliveryRule> = {}): WebexDeliveryRule {
  return {
    entity_slug: "example-project",
    entity_title: "Example Project",
    entity_type: "project",
    destination: "off",
    cadence: "immediate",
    hour: 9,
    weekday: 1,
    timezone: "Europe/Rome",
    ...overrides,
  };
}

function show(overrides: Partial<WebexDeliveryRule> = {}) {
  const delivery: WebexDeliveryState = {
    capability: { available: true },
    ruleFor: () => rule(overrides),
    save: () => {},
    spaces: [],
    spacesState: { loading: false, error: null },
    needSpaces: () => {},
    busy: false,
  };
  return render(
    <WebexRuleChip
      entitySlug="example-project"
      entityTitle="Example Project"
      entityType="project"
      delivery={delivery}
      busy={false}
    />,
  );
}

/** The chip is the only summary of a rule the tree shows, so it has to be
 *  readable at a glance and honest about rules that send nothing. */
describe("the delivery chip", () => {
  it("offers Webex on a row that has never been configured", () => {
    show({ destination: "off" });
    expect(
      screen.getByRole("button", { name: "Send Example Project updates to Webex" }),
    ).toHaveTextContent("Webex");
  });

  it("names the destination and the cadence once it sends", () => {
    show({ destination: "direct", cadence: "weekly" });
    expect(screen.getByRole("button")).toHaveTextContent("DM · weekly");
  });

  it("uses the space's own name rather than the word space", () => {
    show({
      destination: "space",
      space_id: "space-1",
      space_name: "Platform Guild",
      cadence: "immediate",
    });
    expect(screen.getByRole("button")).toHaveTextContent(
      "Platform Guild · as it happens",
    );
  });

  // A space was asked for and not chosen: nothing has been saved and nothing
  // will be sent, so the chip must not report a working rule.
  it("asks for the missing space instead of claiming delivery", () => {
    show({ destination: "space", cadence: "daily" });
    expect(screen.getByRole("button")).toHaveTextContent("Pick a space");
    expect(screen.getByRole("button")).not.toHaveTextContent("daily");
  });

  it("carries the project's name for anyone reading the tree aloud", () => {
    show({ destination: "direct", cadence: "daily" });
    expect(
      screen.getByRole("button", {
        name: "Webex delivery for Example Project: DM · daily",
      }),
    ).toBeInTheDocument();
  });
});
