import { act, fireEvent, render, screen } from "@testing-library/react";

import { MYAGENT_BROWSER_ACTION_HEADER } from "@/lib/tome/myagent-interactive";
import type { ProjectSources } from "@/types/projects";
import { AutosavingSourcesEditor } from "../AutosavingSourcesEditor";

const selectedSources = {
  confluence_url: "https://example.atlassian.net/wiki/spaces/PLATFORM",
  confluence_page_scopes: [
    {
      page_id: "123",
      page_title: "Architecture",
      space_key: "PLATFORM",
      include_descendants: true,
    },
  ],
};

jest.mock("../SourcesEditor", () => ({
  SourcesEditor: ({
    onChange,
  }: {
    onChange: (next: ProjectSources) => void;
  }) => (
    <>
      <button type="button" onClick={() => onChange(selectedSources)}>
        Select page root
      </button>
      <button
        type="button"
        onClick={() =>
          onChange({
            repos: [],
            myagent_connectors: ["outlook"],
            myagent_enabled: true,
          })
        }
      >
        Enable MyAgent
      </button>
    </>
  ),
}));

describe("AutosavingSourcesEditor", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          project: {
            slug: "example",
            sources: selectedSources,
          },
        },
      }),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("saves source selections after the debounce timeout", async () => {
    const onDirtyChange = jest.fn();
    render(
      <AutosavingSourcesEditor
        slug="example"
        kinds={["confluence"]}
        value={{}}
        onChange={jest.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select page root" }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("Source changes pending…")).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(800);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Source selections saved")).toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(global.fetch).toHaveBeenCalledWith("/api/projects/example", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sources: {
          ...selectedSources,
          repos: [],
          confluence_page_scope: null,
        },
      }),
    });
  });

  it("flushes a pending save when focus leaves the source editor", async () => {
    render(
      <>
        <AutosavingSourcesEditor
          slug="example"
          kinds={["confluence"]}
          value={{}}
          onChange={jest.fn()}
        />
        <button type="button">Outside</button>
      </>,
    );

    const selectButton = screen.getByRole("button", {
      name: "Select page root",
    });
    selectButton.focus();
    await act(async () => {
      fireEvent.click(selectButton);
      fireEvent.blur(selectButton, {
        relatedTarget: screen.getByRole("button", { name: "Outside" }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Source selections saved")).toBeInTheDocument();
  });

  it("strips MyAgent fields from generic PATCH and saves them through the dedicated endpoint", async () => {
    const onChange = jest.fn();
    const onSaved = jest.fn();
    const boundRooms = [{
      room_id: "room-a", name: "Example space", slug: "example-space",
      credential_mode: "managed", credential_provider: "webex_messaging",
      added_by: { subject: "creator", email: "creator@example.test" },
    }];
    (global.fetch as jest.Mock).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/projects/example/myagent-consent") {
          expect(init).toMatchObject({ method: "PUT" });
          expect(init?.headers).toMatchObject({ [MYAGENT_BROWSER_ACTION_HEADER]: "1" });
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: { sources: { myagent_connectors: ["outlook"], myagent_enabled: true, myagent_consent_revision: "consent-1" } },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { project: { slug: "example", sources: { webex_rooms: boundRooms, myagent_enabled: false } } } }),
        };
      },
    );
    render(
      <AutosavingSourcesEditor
        slug="example"
        kinds={["webex", "myagent"]}
        value={{ repos: [] }}
        onChange={onChange}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Enable MyAgent" }));
    await act(async () => {
      jest.advanceTimersByTime(800);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "/api/projects/example",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          sources: {
            repos: [],
            confluence_url: "",
            confluence_page_scopes: [],
            confluence_page_scope: null,
          },
        }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "/api/projects/example/myagent-consent",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ connectors: ["outlook"], revision: null }),
      }),
    );
    const combinedSources = {
      webex_rooms: boundRooms,
      myagent_connectors: ["outlook"],
      myagent_enabled: true,
      myagent_consent_revision: "consent-1",
    };
    expect(onChange).toHaveBeenLastCalledWith(combinedSources);
    expect(onSaved).toHaveBeenLastCalledWith(expect.objectContaining({ sources: combinedSources }));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
