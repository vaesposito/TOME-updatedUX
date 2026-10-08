import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  decodeConfluenceSource,
  encodeConfluenceSource,
} from "@/lib/projects/confluence-source";
import { SOURCE_ADAPTERS } from "../adapters";
import { SourceItemPicker } from "../SourceItemPicker";

const confluenceSource = (spaceKey: string) =>
  encodeConfluenceSource({
    url: `https://example.atlassian.net/wiki/spaces/${spaceKey}`,
    base_url: "https://example.atlassian.net",
    space_key: spaceKey,
    name: spaceKey,
  });

const mockUseSourceOptions = jest.fn();
const mockPageScope = {
  page_id: "123",
  page_title: "Architecture",
  space_key: "MARKETING",
  include_descendants: true,
};

jest.mock("../useSourceOptions", () => ({
  useSourceOptions: (...args: unknown[]) => mockUseSourceOptions(...args),
}));

jest.mock("../ConfluenceSpaceBrowser", () => ({
  // This component owns the entire-space-vs-page-tree choice and commits
  // there, so stub a minimal "Add source" button instead of mocking it away.
  ConfluenceSpaceBrowser: (props: {
    sourceUrl: string;
    requireExplicitAdd?: boolean;
    onSelect: (url: string, scopes: never[]) => void;
  }) =>
    props.requireExplicitAdd ? (
      <button onClick={() => props.onSelect(props.sourceUrl, [])}>
        Add source
      </button>
    ) : (
      <button onClick={() => props.onSelect(props.sourceUrl, [mockPageScope] as never[])}>
        Apply page scope
      </button>
    ),
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

  it.each([false, true])("distinguishes no shared spaces from already-added spaces (shared returned: %s)", (hasShared) => {
    mockUseSourceOptions.mockReturnValue({
      connected: true, loading: false, manageUrl: "/credentials",
      options: hasShared ? [{ value: "room-a", label: "Space A" }, { value: "room-b", label: "Space B" }] : [],
      managedCapability: { available: true, accountEmail: "managed@example.com" },
      search: jest.fn(), reload: jest.fn(),
    });
    render(<SourceItemPicker adapter={SOURCE_ADAPTERS.webex} selected={[]} excludedKeys={["room-a", "room-b"]}
      onChange={jest.fn()} webexCredentialMode="managed" />);
    expect(screen.getByText(`No ${hasShared ? "new " : ""}shared spaces found. You and managed@example.com must both be members.`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Space A" })).not.toBeInTheDocument();
  });

  it("uses new for search results that are all already added, without hiding lookup errors", async () => {
    const state = {
      connected: true, loading: false, manageUrl: "/credentials",
      options: [{ value: "room-a", label: "Space A" }],
      managedCapability: { available: true, accountEmail: "managed@example.com" },
      search: jest.fn(), reload: jest.fn(),
    };
    mockUseSourceOptions.mockReturnValue(state);
    const props = { adapter: SOURCE_ADAPTERS.webex, selected: [], excludedKeys: ["room-a"],
      onChange: jest.fn(), webexCredentialMode: "managed" as const };
    const { rerender } = render(<SourceItemPicker {...props} />);
    await userEvent.setup().type(screen.getByPlaceholderText("Search rooms…"), "Space A");
    expect(screen.getByText("No new shared Webex spaces match your search.")).toBeInTheDocument();
    mockUseSourceOptions.mockReturnValue({ ...state, error: "Unable to verify shared spaces. Contact an administrator." });
    rerender(<SourceItemPicker {...props} />);
    expect(screen.getByText("Unable to verify shared spaces. Contact an administrator.")).toBeInTheDocument();
    expect(screen.queryByText("No new shared Webex spaces match your search.")).not.toBeInTheDocument();
  });

  it("asks for the exact configured app name when adding a personal Webex space", () => {
    mockUseSourceOptions.mockReturnValue({ connected: false, options: [], loading: false,
      connection: { provider: "custom_messaging", name: "Example Messaging" }, manageUrl: "/credentials",
      search: jest.fn(), reload: jest.fn() });
    render(<SourceItemPicker adapter={SOURCE_ADAPTERS.webex} selected={[]} onChange={jest.fn()} />);
    expect(screen.getByText(/Example Messaging not connected — link Example Messaging in/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connections" })).toHaveAttribute("target", "_blank");
  });

  it("shows a connected card per attached Confluence space and lets the user remove one", () => {
    const onChange = jest.fn();
    render(
      <SourceItemPicker
        adapter={SOURCE_ADAPTERS.confluence}
        selected={[confluenceSource("PLATFORM"), confluenceSource("MARKETING")]}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("PLATFORM")).toBeInTheDocument();
    expect(screen.getByText("MARKETING")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
    // Not at the cap and not actively adding — offer "+ Add" instead of the search box.
    expect(screen.getByRole("button", { name: /Add Confluence space/ })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(SOURCE_ADAPTERS.confluence.searchPlaceholder)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(onChange).toHaveBeenCalledWith([confluenceSource("MARKETING")]);
  });

  it("expands the search box to pick the next space, up to the cap", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SourceItemPicker
        adapter={SOURCE_ADAPTERS.confluence}
        selected={[confluenceSource("PLATFORM")]}
        onChange={jest.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Add Confluence space/ }));
    expect(
      screen.getByPlaceholderText(SOURCE_ADAPTERS.confluence.searchPlaceholder),
    ).toBeInTheDocument();

    const atCap = Array.from({ length: SOURCE_ADAPTERS.confluence.maxSelected! }, (_, i) =>
      confluenceSource(`SPACE${i}`),
    );
    rerender(
      <SourceItemPicker adapter={SOURCE_ADAPTERS.confluence} selected={atCap} onChange={jest.fn()} />,
    );
    expect(screen.getByText(/Up to \d+ Confluence spaces per project\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Confluence space/ })).not.toBeInTheDocument();
  });

  it("collapses each space to a one-line summary by default, expandable via its own toggle", async () => {
    const user = userEvent.setup();
    render(
      <SourceItemPicker
        adapter={SOURCE_ADAPTERS.confluence}
        selected={[confluenceSource("PLATFORM")]}
        onChange={jest.fn()}
      />,
    );

    const summary = screen.getByRole("button", { name: /Entire space.*Edit/ });
    expect(summary).toBeInTheDocument();
    const header = screen.getByRole("button", { name: /Connected to.*PLATFORM/ });
    expect(header).toHaveAttribute("aria-expanded", "false");

    await user.click(summary);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: /Entire space.*Edit/ })).not.toBeInTheDocument();
  });

  it("auto-expands only the newly added space and collapses the rest", async () => {
    mockUseSourceOptions.mockReturnValue({
      connected: true,
      connectedTo: "example.atlassian.net",
      options: [{ value: "https://example.atlassian.net/wiki/spaces/MARKETING", label: "Marketing" }],
      loading: false,
      manageUrl: "",
      search: jest.fn(),
      reload: jest.fn(),
    });
    const onChange = jest.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <SourceItemPicker
        adapter={SOURCE_ADAPTERS.confluence}
        selected={[confluenceSource("PLATFORM")]}
        onChange={onChange}
      />,
    );

    // Expand the existing space first, to prove adding a new one collapses it back.
    await user.click(screen.getByRole("button", { name: /Entire space.*Edit/ }));
    expect(screen.getByRole("button", { name: /Connected to.*PLATFORM/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await user.click(screen.getByRole("button", { name: /Add Confluence space/ }));
    await user.click(screen.getByRole("button", { name: "Marketing" }));

    // Picking a space from the list stages it — nothing commits until the
    // explicit "Add source" confirm in its scope panel.
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Add source" }));

    const nextSelected = onChange.mock.calls[0][0] as string[];
    expect(nextSelected).toHaveLength(2);

    rerender(
      <SourceItemPicker
        adapter={SOURCE_ADAPTERS.confluence}
        selected={nextSelected}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("button", { name: /Connected to.*PLATFORM/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: /Connected to.*Marketing/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("shows an already-added space as a disabled 'Added' row in the add-another list, not a second removal control", async () => {
    mockUseSourceOptions.mockReturnValue({
      connected: true,
      connectedTo: "example.atlassian.net",
      options: [
        { value: "https://example.atlassian.net/wiki/spaces/PLATFORM", label: "Platform" },
        { value: "https://example.atlassian.net/wiki/spaces/MARKETING", label: "Marketing" },
      ],
      loading: false,
      manageUrl: "",
      search: jest.fn(),
      reload: jest.fn(),
    });
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(
      <SourceItemPicker
        adapter={SOURCE_ADAPTERS.confluence}
        selected={[confluenceSource("PLATFORM")]}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Add Confluence space/ }));

    // "Platform" also matches the card's own header toggle button, so narrow
    // to the disabled row inside the add-another list.
    const addedRow = screen
      .getAllByRole("button", { name: /Platform/ })
      .find((button) => button.hasAttribute("disabled"))!;
    expect(addedRow).toBeDisabled();
    expect(addedRow).toHaveTextContent("Added");
    fireEvent.click(addedRow);
    expect(onChange).not.toHaveBeenCalled();

    // The not-yet-added space stays a normal, clickable row.
    const newRow = screen.getByRole("button", { name: /Marketing/ });
    expect(newRow).not.toBeDisabled();
  });

  it("shows how many of the allowed spaces are selected", () => {
    const cap = SOURCE_ADAPTERS.confluence.maxSelected!;
    const { rerender } = render(
      <SourceItemPicker
        adapter={SOURCE_ADAPTERS.confluence}
        selected={[confluenceSource("PLATFORM")]}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText(`1 of ${cap} space selected`)).toBeInTheDocument();

    rerender(
      <SourceItemPicker
        adapter={SOURCE_ADAPTERS.confluence}
        selected={[confluenceSource("PLATFORM"), confluenceSource("MARKETING")]}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText(`2 of ${cap} spaces selected`)).toBeInTheDocument();
  });

  it("keeps a space's identity when only its page scope is edited", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    const platform = confluenceSource("PLATFORM");
    const marketing = encodeConfluenceSource({
      url: "https://example.atlassian.net/wiki/spaces/MARKETING",
      base_url: "https://example.atlassian.net",
      space_key: "MARKETING",
      name: "Marketing",
      slug: "marketing-2",
    });
    render(
      <SourceItemPicker
        adapter={SOURCE_ADAPTERS.confluence}
        selected={[platform, marketing]}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Connected to.*Marketing/ }));
    await user.click(screen.getByRole("button", { name: "Apply page scope" }));

    const [next] = onChange.mock.calls[0] as [string[]];
    expect(next[0]).toBe(platform);
    expect(decodeConfluenceSource(next[1])).toMatchObject({
      slug: "marketing-2",
      name: "Marketing",
      base_url: "https://example.atlassian.net",
      space_key: "MARKETING",
      page_scopes: [mockPageScope],
    });
  });

  describe("when the selection changes between staging a space and confirming it", () => {
    const marketingOption = {
      value: "https://example.atlassian.net/wiki/spaces/MARKETING",
      label: "Marketing",
    };

    async function stageMarketing(onChange: jest.Mock) {
      mockUseSourceOptions.mockReturnValue({
        connected: true,
        connectedTo: "example.atlassian.net",
        options: [marketingOption],
        loading: false,
        manageUrl: "",
        search: jest.fn(),
        reload: jest.fn(),
      });
      const user = userEvent.setup();
      const view = render(
        <SourceItemPicker
          adapter={SOURCE_ADAPTERS.confluence}
          selected={[confluenceSource("PLATFORM")]}
          onChange={onChange}
        />,
      );
      await user.click(screen.getByRole("button", { name: /Add Confluence space/ }));
      await user.click(screen.getByRole("button", { name: "Marketing" }));
      return { user, ...view };
    }

    it("refuses to add a space that is now already selected", async () => {
      const onChange = jest.fn();
      const { user, rerender } = await stageMarketing(onChange);

      rerender(
        <SourceItemPicker
          adapter={SOURCE_ADAPTERS.confluence}
          selected={[confluenceSource("PLATFORM"), confluenceSource("MARKETING")]}
          onChange={onChange}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Add source" }));

      expect(screen.getByText("This space is already added.")).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("refuses to add a space once the cap has been reached", async () => {
      const onChange = jest.fn();
      const { user, rerender } = await stageMarketing(onChange);

      rerender(
        <SourceItemPicker
          adapter={SOURCE_ADAPTERS.confluence}
          selected={Array.from({ length: SOURCE_ADAPTERS.confluence.maxSelected! }, (_, i) =>
            confluenceSource(`SPACE${i}`),
          )}
          onChange={onChange}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Add source" }));

      expect(
        screen.getByText("This project already has the maximum number of Confluence spaces."),
      ).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });
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
