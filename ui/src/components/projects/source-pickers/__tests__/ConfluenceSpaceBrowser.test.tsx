import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { ConfluenceSpaceBrowser } from "../ConfluenceSpaceBrowser";
import type { ConfluencePageScope } from "@/types/projects";

const spaceUrl = "https://example.atlassian.net/wiki/spaces/PLATFORM";

describe("ConfluenceSpaceBrowser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps each instance's scope radios independent via a unique groupName", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ConfluenceSpaceBrowser
          sourceUrl="https://example.atlassian.net/wiki/spaces/PLATFORM"
          scopes={[]}
          onSelect={jest.fn()}
          spaceLabel="Platform"
          groupName="platform"
        />
        <ConfluenceSpaceBrowser
          sourceUrl="https://example.atlassian.net/wiki/spaces/MARKETING"
          scopes={[]}
          onSelect={jest.fn()}
          spaceLabel="Marketing"
          groupName="marketing"
        />
      </>,
    );

    const [platformGroup, marketingGroup] = screen.getAllByRole("radiogroup");
    const platformPageTree = within(platformGroup).getByRole("radio", {
      name: /Choose a page tree/,
    });
    const marketingPageTree = within(marketingGroup).getByRole("radio", {
      name: /Choose a page tree/,
    });
    expect(platformPageTree).not.toHaveAttribute(
      "name",
      marketingPageTree.getAttribute("name"),
    );

    await user.click(platformPageTree);
    expect(platformPageTree).toBeChecked();
    expect(marketingPageTree).not.toBeChecked();
  });

  it("searches and selects multiple page roots without overlapping trees", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            kind: "space",
            source_url: spaceUrl,
            space_key: "PLATFORM",
            pages: [
              {
                id: "100",
                title: "Overview",
                parent_id: null,
                depth: 0,
                url: `${spaceUrl}/pages/100`,
              },
            ],
            truncated: true,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            kind: "page",
            source_url: `${spaceUrl}/pages/100`,
            scope: {
              page_id: "100",
              page_title: "Overview",
              space_key: "PLATFORM",
              include_descendants: true,
            },
            pages: [
              {
                id: "100",
                title: "Overview",
                parent_id: null,
                depth: 0,
                url: `${spaceUrl}/pages/100`,
              },
              {
                id: "200",
                title: "Architecture",
                parent_id: "100",
                depth: 1,
                url: `${spaceUrl}/pages/200`,
              },
              {
                id: "300",
                title: "Runbooks",
                parent_id: "100",
                depth: 1,
                url: `${spaceUrl}/pages/300`,
              },
            ],
            truncated: false,
          },
        }),
      });

    function Harness() {
      const [scopes, setScopes] = useState<ConfluencePageScope[]>([]);
      return (
        <ConfluenceSpaceBrowser
          sourceUrl={spaceUrl}
          scopes={scopes}
          onSelect={(url, next) => {
            setScopes(next);
            onSelect(url, next);
          }}
        />
      );
    }
    render(<Harness />);

    await user.click(screen.getByText("Choose a page tree"));

    expect(await screen.findByText("Pages in PLATFORM")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(
      screen.getByText("1 loaded · expand a page for its complete subtree"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Architecture")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Expand Overview"));

    expect(await screen.findByText("Architecture")).toBeInTheDocument();
    expect(screen.getByText("Runbooks")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenLastCalledWith(
      "/api/projects/confluence/resolve",
      expect.objectContaining({
        body: JSON.stringify({ url: `${spaceUrl}/pages/100` }),
      }),
    );

    await user.type(
      screen.getByLabelText("Search pages in this Confluence space"),
      "arch",
    );

    expect(screen.getByText("1 match")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Architecture")).toBeInTheDocument();
    // Non-matching rows stay mounted and fade rather than unmount, so the
    // tree's shape doesn't reset as the user types.
    expect(
      screen.getByText("Runbooks").closest("li")?.querySelector("div"),
    ).toHaveClass("opacity-30");

    await user.click(screen.getByText("Architecture"));

    // Selecting a page is a local draft — nothing is sent until the user
    // explicitly saves it.
    expect(screen.getByText("Selected page roots (1)")).toBeInTheDocument();
    expect(screen.getByText("Not added yet.")).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();

    await user.clear(
      screen.getByLabelText("Search pages in this Confluence space"),
    );
    await user.type(
      screen.getByLabelText("Search pages in this Confluence space"),
      "zzz-no-match",
    );

    // Zero matches must NOT collapse the tree section entirely — it should
    // fade all rows and show a "no matches" hint alongside them, not instead
    // of them (a fieldset/legend layout bug previously made this whole
    // section vanish).
    const tree = screen.getByRole("tree");
    expect(screen.getByText("No page titles match this search.")).toBeInTheDocument();
    expect(within(tree).getByText("Overview")).toBeInTheDocument();
    expect(within(tree).getByText("Architecture")).toBeInTheDocument();
    expect(within(tree).getByText("Runbooks")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Clear page search"));
    await user.click(screen.getByText("Runbooks"));

    expect(screen.getByText("Selected page roots (2)")).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();

    const saveButton = screen.getByRole("button", {
      name: "Save page selection",
    });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    expect(onSelect).toHaveBeenCalledWith(
      spaceUrl,
      expect.arrayContaining([
        expect.objectContaining({ page_id: "200" }),
        expect.objectContaining({ page_id: "300" }),
      ]),
    );
    expect(await screen.findByText("Added.")).toBeInTheDocument();
    expect(saveButton).toBeDisabled();

    await user.click(screen.getAllByText("Overview")[0]);
    expect(screen.getByText("Selected page roots (1)")).toBeInTheDocument();
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);
    expect(onSelect).toHaveBeenLastCalledWith(spaceUrl, [
      expect.objectContaining({ page_id: "100" }),
    ]);
  });

  it("restores the previous page selection after switching to Entire space and back", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    const initialScope: ConfluencePageScope = {
      page_id: "100",
      page_title: "Overview",
      space_key: "PLATFORM",
      include_descendants: true,
    };

    function Harness() {
      const [scopes, setScopes] = useState<ConfluencePageScope[]>([
        initialScope,
      ]);
      return (
        <ConfluenceSpaceBrowser
          sourceUrl={spaceUrl}
          scopes={scopes}
          onSelect={(url, next) => {
            setScopes(next);
            onSelect(url, next);
          }}
        />
      );
    }
    render(<Harness />);

    expect(screen.getByText("Choose a page tree")).toBeInTheDocument();

    await user.click(screen.getByText("Entire space"));
    expect(onSelect).toHaveBeenLastCalledWith(spaceUrl, []);

    await user.click(screen.getByText("Choose a page tree"));
    expect(onSelect).toHaveBeenLastCalledWith(spaceUrl, [initialScope]);
  });

  it("collapses the browse tree behind a toggle when a page root is already selected", async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          kind: "space",
          source_url: spaceUrl,
          space_key: "PLATFORM",
          pages: [
            { id: "100", title: "Overview", parent_id: null, depth: 0, url: `${spaceUrl}/pages/100` },
          ],
          truncated: false,
        },
      }),
    });

    render(
      <ConfluenceSpaceBrowser
        sourceUrl={spaceUrl}
        scopes={[
          {
            page_id: "100",
            page_title: "Overview",
            space_key: "PLATFORM",
            include_descendants: true,
          },
        ]}
        onSelect={jest.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", {
        name: /Browse to add another page root/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Selected page roots (1)")).toBeInTheDocument();
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Browse to add another page root/ }),
    );

    expect(await screen.findByRole("tree")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Hide page browser/ }),
    );

    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Browse to add another page root/ }),
    ).toBeInTheDocument();
  });

  it("doesn't offer to expand a leaf page once the full tree is known", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          kind: "space",
          source_url: spaceUrl,
          space_key: "PLATFORM",
          pages: [
            { id: "100", title: "Overview", parent_id: null, depth: 0, url: `${spaceUrl}/pages/100` },
            { id: "200", title: "Leaf Page", parent_id: null, depth: 0, url: `${spaceUrl}/pages/200` },
          ],
          truncated: false,
        },
      }),
    });

    render(
      <ConfluenceSpaceBrowser
        sourceUrl={spaceUrl}
        scopes={[]}
        onSelect={jest.fn()}
      />,
    );

    await userEvent.setup().click(screen.getByText("Choose a page tree"));

    expect(await screen.findByText("Leaf Page")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Expand Leaf Page"),
    ).not.toBeInTheDocument();
  });

  it("uses Confluence's child flag to hide expanders on leaves in a truncated preview", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          kind: "space",
          source_url: spaceUrl,
          space_key: "PLATFORM",
          pages: [
            { id: "100", title: "Parent Page", parent_id: null, depth: 0, url: `${spaceUrl}/pages/100`, has_children: true },
            { id: "200", title: "Leaf Page", parent_id: null, depth: 0, url: `${spaceUrl}/pages/200`, has_children: false },
            { id: "300", title: "Unknown Page", parent_id: null, depth: 0, url: `${spaceUrl}/pages/300` },
          ],
          truncated: true,
        },
      }),
    });

    render(
      <ConfluenceSpaceBrowser
        sourceUrl={spaceUrl}
        scopes={[]}
        onSelect={jest.fn()}
      />,
    );

    await userEvent.setup().click(screen.getByText("Choose a page tree"));

    expect(await screen.findByText("Leaf Page")).toBeInTheDocument();
    expect(screen.getByLabelText("Expand Parent Page")).toBeInTheDocument();
    expect(screen.queryByLabelText("Expand Leaf Page")).not.toBeInTheDocument();
    // No flag from Confluence: stay conservative and keep the expander.
    expect(screen.getByLabelText("Expand Unknown Page")).toBeInTheDocument();
  });

  it("keeps an in-progress page selection across a parent re-render", async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          kind: "space",
          source_url: spaceUrl,
          space_key: "PLATFORM",
          pages: [
            { id: "100", title: "Overview", parent_id: null, depth: 0, url: `${spaceUrl}/pages/100` },
          ],
          truncated: false,
        },
      }),
    });

    const { rerender } = render(
      <ConfluenceSpaceBrowser sourceUrl={spaceUrl} scopes={[]} onSelect={jest.fn()} />,
    );

    await user.click(screen.getByText("Choose a page tree"));
    await user.click(await screen.findByText("Overview"));
    expect(screen.getByText("Selected page roots (1)")).toBeInTheDocument();

    // A parent re-render passes a new but equal `scopes` array (e.g. decoded
    // fresh from storage each render) — it must not clear the unsaved pick.
    rerender(
      <ConfluenceSpaceBrowser sourceUrl={spaceUrl} scopes={[]} onSelect={jest.fn()} />,
    );

    expect(screen.getByText("Selected page roots (1)")).toBeInTheDocument();
    expect(screen.getByText("Not added yet.")).toBeInTheDocument();
  });

  it("states explicitly when the entire space is included, scoped to the space label", () => {
    render(
      <ConfluenceSpaceBrowser
        sourceUrl={spaceUrl}
        scopes={[]}
        onSelect={jest.fn()}
        spaceLabel="PLATFORM"
      />,
    );

    expect(
      screen.getByText("All accessible pages in PLATFORM are included."),
    ).toBeInTheDocument();
  });

  it("attributes the scope choice to the connected space", () => {
    render(
      <ConfluenceSpaceBrowser
        sourceUrl={spaceUrl}
        scopes={[]}
        onSelect={jest.fn()}
        spaceLabel="PLATFORM"
      />,
    );

    expect(
      screen.getByText((_, node) =>
        node?.textContent === "What should be included from PLATFORM?",
      ),
    ).toBeInTheDocument();
  });
});
