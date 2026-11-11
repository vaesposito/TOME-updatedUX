/** @jest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";

import { ToastProvider } from "@/components/ui/toast";

import { useWebexDelivery } from "../useWebexDelivery";

/** Reads the hook the way the Watching tab's rows read it. */
function Probe() {
  const delivery = useWebexDelivery();
  const rule = delivery.ruleFor({
    entity_slug: "example-project",
    entity_title: "Example Project",
    entity_type: "project",
  });
  return (
    <p>
      {delivery.capability.available ? "available" : "unavailable"}:{" "}
      {rule.destination}
    </p>
  );
}

function show() {
  return render(
    <ToastProvider>
      <Probe />
    </ToastProvider>,
  );
}

function answer(body: unknown) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => body,
  })) as jest.Mock;
}

describe("the Webex delivery settings", () => {
  it("takes the rules the server sent", async () => {
    answer({
      data: {
        capability: { available: true },
        rules: [
          {
            entity_slug: "example-project",
            entity_title: "Example Project",
            entity_type: "project",
            destination: "direct",
            cadence: "weekly",
            hour: 9,
            weekday: 1,
            timezone: "Europe/Rome",
          },
        ],
      },
    });
    show();
    expect(await screen.findByText("available: direct")).toBeInTheDocument();
  });

  // The tab draws a chip per row off these settings, so a payload without a
  // rule list used to take the whole page to the error boundary. Nothing can
  // be made of such an answer, and an unconfigured tab says more than that.
  it("falls back when the payload carries no rules", async () => {
    answer({ data: { targets: [], webex: null } });
    show();
    await waitFor(() =>
      expect(screen.getByText("available: off")).toBeInTheDocument(),
    );
  });

  it("falls back when the payload is not the envelope at all", async () => {
    answer({ rules: null });
    show();
    await waitFor(() =>
      expect(screen.getByText("available: off")).toBeInTheDocument(),
    );
  });
});
