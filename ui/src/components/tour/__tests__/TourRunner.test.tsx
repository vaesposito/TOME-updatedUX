/** @jest-environment jsdom */

/**
 * A step with nothing to point at is still part of the walkthrough.
 *
 * An anchored step dims the window with its spotlight's very wide shadow.
 * One that cannot find its control used to be drawn over a fully lit page,
 * which read as a stray dialog rather than as the tour it belongs to.
 */

import { act, render, screen, waitFor } from "@testing-library/react";

import { TourRunner } from "../TourRunner";
import { TOUR_START_EVENT, type TourStep } from "../notification-tour";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/notifications",
}));

const NEEDS_A_PROJECT: readonly TourStep[] = [
  {
    id: "borrowed",
    anchor: "project-home",
    // The reader can read no project, so there is nowhere to send them.
    route: () => null,
    title: "A project's Home gathers them",
    body: "Never shown, because the step cannot be reached.",
    unavailable: "This step needs a project you can read, and there is not one yet.",
  },
];

describe("a step that cannot be reached", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { nodes: [] } }),
    }) as unknown as typeof fetch;
  });

  it("says what is missing, over a dimmed page", async () => {
    render(
      <TourRunner
        tour={NEEDS_A_PROJECT}
        stateKey="grid.tour.test"
        startEvent={TOUR_START_EVENT}
        label="Test walkthrough"
      />,
    );

    act(() => {
      window.dispatchEvent(new Event(TOUR_START_EVENT));
    });

    expect(
      await screen.findByText(
        "This step needs a project you can read, and there is not one yet.",
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("tour-backdrop")).toBeInTheDocument(),
    );
  });
});
