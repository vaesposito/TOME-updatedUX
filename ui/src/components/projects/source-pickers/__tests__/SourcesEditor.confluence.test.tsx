import { fireEvent, render, screen } from "@testing-library/react";

import {
  decodeConfluenceSource,
  encodeConfluenceSource,
} from "@/lib/projects/confluence-source";
import type { ProjectSources } from "@/types/projects";
import { SourcesEditor } from "../SourcesEditor";

const mockPickerProps = jest.fn();
let mockNextSelection: string[] = [];

jest.mock("@/hooks/use-myagent-enabled", () => ({
  useMyAgentEnabled: () => false,
}));

jest.mock("../index", () => ({
  SourcePicker: (props: { selected: string[]; onChange: (next: string[]) => void }) => {
    mockPickerProps(props);
    return (
      <button type="button" onClick={() => props.onChange(mockNextSelection)}>
        Change selection
      </button>
    );
  },
}));

const site = "https://example.atlassian.net";
const scope = {
  page_id: "123",
  page_title: "Architecture",
  space_key: "PLATFORM",
  include_descendants: true,
};

function pickerSelection(): string[] {
  return mockPickerProps.mock.calls.at(-1)?.[0].selected;
}

describe("SourcesEditor Confluence sources", () => {
  beforeEach(() => {
    mockPickerProps.mockClear();
    mockNextSelection = [];
  });

  it("shows no selection for a project without Confluence sources", () => {
    render(<SourcesEditor kinds={["confluence"]} value={{}} onChange={jest.fn()} />);

    expect(pickerSelection()).toEqual([]);
  });

  it("hands the picker one entry per attached space", () => {
    render(
      <SourcesEditor
        kinds={["confluence"]}
        value={{
          confluence_spaces: [
            { slug: "platform", name: "Platform", space_key: "PLATFORM", base_url: site, page_scopes: [scope] },
            { slug: "marketing", name: "Marketing", space_key: "MARKETING", base_url: site },
          ],
        }}
        onChange={jest.fn()}
      />,
    );

    expect(pickerSelection().map((v) => decodeConfluenceSource(v))).toEqual([
      expect.objectContaining({ space_key: "PLATFORM", page_scopes: [scope], slug: "platform" }),
      expect.objectContaining({ space_key: "MARKETING", page_scopes: [], slug: "marketing" }),
    ]);
  });

  it("prefers confluence_spaces over a legacy confluence_url", () => {
    render(
      <SourcesEditor
        kinds={["confluence"]}
        value={{
          confluence_url: `${site}/wiki/spaces/LEGACY`,
          confluence_spaces: [
            { slug: "platform", name: "Platform", space_key: "PLATFORM", base_url: site },
          ],
        }}
        onChange={jest.fn()}
      />,
    );

    expect(pickerSelection().map((v) => decodeConfluenceSource(v).space_key)).toEqual(["PLATFORM"]);
  });

  it("presents a legacy confluence_url and its page scopes as one space", () => {
    render(
      <SourcesEditor
        kinds={["confluence"]}
        value={{
          confluence_url: `${site}/wiki/spaces/PLATFORM`,
          confluence_page_scopes: [scope],
        }}
        onChange={jest.fn()}
      />,
    );

    expect(pickerSelection().map((v) => decodeConfluenceSource(v))).toEqual([
      expect.objectContaining({
        url: `${site}/wiki/spaces/PLATFORM`,
        base_url: site,
        space_key: "PLATFORM",
        page_scopes: [scope],
      }),
    ]);
  });

  it("falls back to the legacy singular page scope", () => {
    render(
      <SourcesEditor
        kinds={["confluence"]}
        value={{
          confluence_url: `${site}/wiki/spaces/PLATFORM`,
          confluence_page_scope: scope,
        }}
        onChange={jest.fn()}
      />,
    );

    expect(decodeConfluenceSource(pickerSelection()[0]).page_scopes).toEqual([scope]);
  });

  it("writes confluence_spaces on change and clears the legacy fields", () => {
    const onChange = jest.fn();
    const value: ProjectSources = {
      repos: ["https://github.com/example/repo"],
      confluence_url: `${site}/wiki/spaces/PLATFORM`,
      confluence_page_scopes: [scope],
      confluence_page_scope: scope,
    };
    mockNextSelection = [
      encodeConfluenceSource({
        url: `${site}/wiki/spaces/PLATFORM`,
        base_url: site,
        space_key: "PLATFORM",
        name: "Platform",
        page_scopes: [scope],
      }),
      encodeConfluenceSource({
        url: `${site}/wiki/spaces/MARKETING`,
        base_url: site,
        space_key: "MARKETING",
        name: "Marketing",
      }),
    ];
    render(<SourcesEditor kinds={["confluence"]} value={value} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Change selection" }));

    expect(onChange).toHaveBeenCalledWith({
      repos: ["https://github.com/example/repo"],
      confluence_spaces: [
        { slug: "platform", name: "Platform", space_key: "PLATFORM", base_url: site, page_scopes: [scope] },
        { slug: "marketing", name: "Marketing", space_key: "MARKETING", base_url: site },
      ],
      confluence_url: undefined,
      confluence_page_scopes: undefined,
      confluence_page_scope: undefined,
    });
  });

  it("lists every space as a link in read-only mode", () => {
    render(
      <SourcesEditor
        kinds={["confluence"]}
        readOnly
        value={{
          confluence_spaces: [
            { slug: "platform", name: "Platform", space_key: "PLATFORM", base_url: site },
            { slug: "marketing", name: "Marketing", space_key: "MARKETING", base_url: site },
          ],
        }}
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: "Platform (PLATFORM)" })).toHaveAttribute(
      "href",
      `${site}/wiki/spaces/PLATFORM`,
    );
    expect(screen.getByRole("link", { name: "Marketing (MARKETING)" })).toHaveAttribute(
      "href",
      `${site}/wiki/spaces/MARKETING`,
    );
  });

  it("says nothing is attached in read-only mode without Confluence sources", () => {
    render(<SourcesEditor kinds={["confluence"]} readOnly value={{}} onChange={jest.fn()} />);

    expect(screen.getByText("None attached.")).toBeInTheDocument();
  });
});
