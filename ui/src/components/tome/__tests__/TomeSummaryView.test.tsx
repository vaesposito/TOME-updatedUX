/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import { TomeSummaryView } from "../TomeSummaryView";
import type { TomeSummary, TomeSummaryItem } from "@/types/tome-summary";

function item(overrides: Partial<TomeSummaryItem>): TomeSummaryItem {
  return {
    id: "row",
    title: "Something happened",
    message: "",
    category: "collateral",
    severity: "info",
    event_label: "Page updated",
    entity_slug: "skills-catalog",
    entity_title: "Skills Catalog",
    entity_type: "project",
    created_at: new Date().toISOString(),
    open_days: 1,
    read: false,
    needs_attention: false,
    resolved: false,
    reason: "watching",
    following: true,
    ...overrides,
  };
}

function summary(items: TomeSummaryItem[]): TomeSummary {
  return {
    entity: { slug: "skills-catalog", title: "Skills Catalog", type: "project" },
    headline: "One item needs attention",
    counts: {
      attention: 1,
      open_decisions: 0,
      unread: 1,
      descendants: 0,
      recently_resolved: 0,
    },
    sections: [
      {
        key: "attention",
        title: "Open and needing attention",
        description: "Critical first.",
        items,
        total: items.length,
      },
    ],
  } as TomeSummary;
}

function show(items: TomeSummaryItem[]) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ data: summary(items) }),
  })) as jest.Mock;
  return render(<TomeSummaryView slug="skills-catalog" />);
}

// The complaint this guards: a row whose only destination was the summary it
// already sat on offered an "Open" that did nothing when clicked.
it("offers no link when the row's target is the summary being read", async () => {
  show([item({ href: "/projects/skills-catalog/tome" })]);

  expect(await screen.findByText("Something happened")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Open|Go to/ })).not.toBeInTheDocument();
});

// Still worth a link, but it changes which entity you are reading rather than
// opening the item, so it does not claim to open anything.
it("names a cross-entity hop for what it is", async () => {
  show([
    item({
      entity_slug: "onboarding-revamp",
      entity_title: "Onboarding Revamp",
      href: "/projects/onboarding-revamp/tome",
    }),
  ]);

  const link = await screen.findByRole("link", { name: /Onboarding Revamp/ });
  expect(link).toHaveTextContent("Go to Project");
  expect(link).toHaveAttribute("href", "/projects/onboarding-revamp/tome");
});

it("offers Open when the target is the thing itself", async () => {
  show([item({ href: "/projects/skills-catalog/tome/wiki/charter.md" })]);

  const link = await screen.findByRole("link", { name: /Something happened/ });
  expect(link).toHaveTextContent("Open");
  expect(link).toHaveAttribute("href", "/projects/skills-catalog/tome/wiki/charter.md");
});

it("sends an off-site target to a new tab", async () => {
  show([item({ href: "https://example.com/issues/12" })]);

  const link = await screen.findByRole("link", { name: /Something happened/ });
  expect(link).toHaveTextContent("Open");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
});

it("offers no link when there is no target at all", async () => {
  show([item({})]);

  expect(await screen.findByText("Something happened")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Open|Go to/ })).not.toBeInTheDocument();
});
