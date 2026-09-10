import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SOURCE_ADAPTERS } from "../adapters";
import { SourceItemPicker } from "../SourceItemPicker";

const mockUseSourceOptions = jest.fn();

jest.mock("../useSourceOptions", () => ({
  useSourceOptions: (...args: unknown[]) => mockUseSourceOptions(...args),
}));

jest.mock("../ConfluenceSpaceBrowser", () => ({
  ConfluenceSpaceBrowser: () => null,
}));

jest.mock("../ConfluenceManualAdd", () => ({
  ConfluenceManualAdd: () => null,
}));

describe("SourceItemPicker", () => {
  beforeEach(() => {
    mockUseSourceOptions.mockReturnValue({
      connected: true,
      connectedTo: "example.atlassian.net",
      options: [],
      loading: false,
      manageUrl: "",
      search: jest.fn(),
      reload: jest.fn(),
    });
  });

  it("collapses the picker into a compact 'Connected to X · Change' row once a Confluence space is selected", async () => {
    const user = userEvent.setup();
    const sourceUrl = "https://example.atlassian.net/wiki/spaces/PLATFORM";
    render(
      <SourceItemPicker
        adapter={SOURCE_ADAPTERS.confluence}
        selected={[sourceUrl]}
        onChange={jest.fn()}
        confluencePageScopes={[]}
      />,
    );

    expect(screen.getByText(sourceUrl)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(SOURCE_ADAPTERS.confluence.searchPlaceholder)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change" }));

    expect(
      screen.getByPlaceholderText(SOURCE_ADAPTERS.confluence.searchPlaceholder),
    ).toBeInTheDocument();
  });

  it("explains how to share a space with the managed Webex account", () => {
    mockUseSourceOptions.mockReturnValue({
      connected: true,
      connectedTo: "Managed Webex account",
      options: [],
      loading: false,
      manageUrl: "/credentials",
      managedCapability: {
        enabled: true,
        configured: true,
        available: true,
        provider: "webex_messaging",
        displayName: "Managed Webex account",
        accountEmail: "managed@example.com",
      },
      search: jest.fn(),
      reload: jest.fn(),
    });

    render(
      <SourceItemPicker
        adapter={SOURCE_ADAPTERS.webex}
        selected={[]}
        onChange={jest.fn()}
        webexCredentialMode="managed"
        webexCredentialProvider="webex_messaging"
      />,
    );

    expect(
      screen.getByText((_, element) =>
        element?.tagName === "P" &&
        element.textContent?.includes(
          "Add managed@example.com to each Webex space you want to ingest",
        ) === true,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "No shared spaces found. You and managed@example.com must both be members.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy managed Webex account email" }),
    ).toBeInTheDocument();
  });
});
