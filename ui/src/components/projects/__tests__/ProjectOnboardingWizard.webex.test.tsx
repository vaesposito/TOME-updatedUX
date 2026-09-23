import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ProjectOnboardingWizard } from "../ProjectOnboardingWizard";

jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { email: "test-user@example.com" } } }),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => key === "defaultTeamSlug" ? "example-team" : undefined,
}));

describe("onboarding Webex account switching", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it("clears selected rooms in both directions and preserves them when clicking the active account", async () => {
    global.fetch = jest.fn(async (input) => {
      const url = String(input);
      let data: unknown = {};
      if (url === "/api/projects/onboarding-config") {
        data = { config: { steps: [{
          id: "webex", title: "Webex spaces", provider: "source", source: "webex", default_enabled: true,
        }] } };
      } else if (url === "/api/dynamic-agents/teams") {
        data = [{ _id: "team-1", slug: "example-team", name: "Example Team" }];
      } else if (url.startsWith("/api/projects/source-options")) {
        data = {
          connected: true,
          options: [{ value: "shared-room", label: "Shared room" }],
          managedCapability: { available: true, provider: "webex_messaging" },
        };
      }
      return { ok: true, json: async () => ({ data }) } as Response;
    });
    render(<ProjectOnboardingWizard initialOpen />);
    await screen.findByRole("heading", { name: "Type" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(await screen.findByLabelText(/Project name/), { target: { value: "Example Project" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Shared room" }));
    expect(screen.getByText("1 room selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /My Webex connection/ }));
    expect(screen.getByText("1 room selected")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /Managed Webex account/ }));
    expect(screen.queryByText("1 room selected")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Shared room" }));
    expect(screen.getByText("1 room selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Managed Webex account/ }));
    expect(screen.getByText("1 room selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /My Webex connection/ }));
    expect(screen.queryByText("1 room selected")).not.toBeInTheDocument();
    await screen.findByRole("button", { name: "Shared room" });
  });
});
