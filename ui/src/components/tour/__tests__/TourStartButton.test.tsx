/** @jest-environment jsdom */

/**
 * The chooser, which is the whole point of having five tours.
 *
 * A single button that started a tour of everything made the choice for the
 * reader; what matters here is that each walkthrough is offered by name and
 * that choosing one starts that one.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TourMenu, TourStartButton } from "../TourStartButton";
import { TOUR_START_EVENT } from "../tour";
import { TOURS } from "../tour-catalog";

function listenForStart() {
  const started: (string | null)[] = [];
  window.addEventListener(TOUR_START_EVENT, (event) => {
    started.push(
      (event as CustomEvent<{ id?: string }>).detail?.id ?? null,
    );
  });
  return started;
}

describe("the tour chooser", () => {
  it("offers every walkthrough by name before starting one", async () => {
    const user = userEvent.setup();
    const started = listenForStart();
    render(<TourMenu />);

    expect(started).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: /take a tour/i }));

    for (const tour of TOURS) {
      expect(screen.getByText(tour.name)).toBeInTheDocument();
      expect(screen.getByText(tour.blurb)).toBeInTheDocument();
    }
  });

  it("starts the one that was chosen", async () => {
    const user = userEvent.setup();
    const started = listenForStart();
    render(<TourMenu />);

    await user.click(screen.getByRole("button", { name: /take a tour/i }));
    await user.click(screen.getByText("Connecting spaces"));

    expect(started).toEqual(["linking"]);
  });

  it("lets its host prepare the page first", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    window.addEventListener(TOUR_START_EVENT, () => order.push("started"));
    render(<TourMenu onStart={() => order.push("prepared")} />);

    await user.click(screen.getByRole("button", { name: /take a tour/i }));
    await user.click(screen.getByText("Getting around"));

    expect(order).toEqual(["prepared", "started"]);
  });
});

describe("the inbox's own button", () => {
  it("starts the notifications walkthrough without asking", async () => {
    const user = userEvent.setup();
    const started = listenForStart();
    render(<TourStartButton />);

    await user.click(screen.getByRole("button", { name: /take the tour/i }));

    expect(started).toEqual(["notifications"]);
  });
});
