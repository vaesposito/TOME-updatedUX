import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { OnboardingWebexMeetingSeriesPicker } from "../OnboardingWebexMeetingSeriesPicker";

function Harness() {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <OnboardingWebexMeetingSeriesPicker
      selectedSeriesKeys={selected}
      onSelectedSeriesKeysChange={setSelected}
    />
  );
}

describe("OnboardingWebexMeetingSeriesPicker", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          candidates: [
            {
              seriesKey: "hosted-series",
              title: "Platform weekly",
              hostEmail: "creator@example.test",
              canAutoIngest: true,
              nextOccurrence: { start: "2026-09-10T10:00:00Z" },
            },
            {
              seriesKey: "guest-series",
              title: "Customer update",
              hostEmail: "host@example.test",
              canAutoIngest: false,
              unavailableReason: "Only the host can add this series.",
            },
          ],
        },
      }),
    }) as jest.Mock;
  });

  afterEach(() => jest.clearAllMocks());

  it("preserves selected series when a changed window does not return them", async () => {
    render(<Harness />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Platform weekly" }));
    expect(screen.getByText("1 meeting series selected")).toBeInTheDocument();
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ data: { candidates: [], complete: true } }) });
    fireEvent.change(screen.getByRole("combobox", { name: "Upcoming occurrence window" }), { target: { value: "14" } });
    await screen.findByText(/No recurring Webex meetings were found/);
    expect(global.fetch).toHaveBeenLastCalledWith("/api/tome/webex-meeting-series?lookaheadDays=14", expect.any(Object));
    expect(screen.getByText("1 meeting series selected")).toBeInTheDocument();
  });

  it("warns before selecting a non-hosted series", async () => {
    render(<Harness />);

    const hosted = await screen.findByRole("checkbox", { name: "Select Platform weekly" });
    const guest = screen.getByRole("checkbox", { name: "Select Customer update" });
    expect(global.fetch).toHaveBeenCalledWith("/api/tome/webex-meeting-series?lookaheadDays=7", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(guest).not.toBeDisabled();

    fireEvent.click(guest);
    expect(await screen.findByText("Recording access required")).toBeInTheDocument();
    expect(screen.getByText("0 meeting series selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add with warning" }));
    expect(screen.getByText("1 meeting series selected")).toBeInTheDocument();
    expect(guest).toBeChecked();

    fireEvent.click(hosted);
    expect(screen.getByText("2 meeting series selected")).toBeInTheDocument();
    expect(hosted).toBeChecked();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search recurring Webex meetings" }), {
      target: { value: "customer" },
    });
    expect(screen.queryByText("Platform weekly")).not.toBeInTheDocument();
    expect(screen.getByText("Customer update")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("2 meeting series selected")).toBeInTheDocument();
  });

  it("disables non-hosted series when the server policy is off", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          allowNonHostSeries: false,
          candidates: [
            {
              seriesKey: "guest-series",
              title: "Customer update",
              hostEmail: "host@example.test",
              canAutoIngest: false,
            },
          ],
        },
      }),
    });

    render(<Harness />);

    expect(
      await screen.findByText("Non-hosted meeting series are disabled by your administrator"),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Customer update" })).toBeDisabled();
    expect(screen.queryByText("Recording access required")).not.toBeInTheDocument();
  });

  it("opens the Webex Meetings connection page in a new tab", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => ({
        code: "WEBEX_MEETINGS_CONNECTION_REQUIRED",
        error: "Webex Meetings is not connected.",
      }),
    });

    render(<Harness />);

    const link = await screen.findByRole("link", { name: "Connect Webex (Meetings)" });
    expect(link).toHaveAttribute("href", "/credentials#connections");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
