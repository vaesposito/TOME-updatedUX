import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { encodeConfluenceSource } from "@/lib/projects/confluence-source";
import { ProjectOnboardingWizard } from "../ProjectOnboardingWizard";

jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { email: "test-user@example.com" } } }),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => (key === "defaultTeamSlug" ? "example-team" : undefined),
}));

let mockNextSelection: string[] = [];
jest.mock("@/components/projects/source-pickers", () => ({
  SourcePicker: (props: { onChange: (next: string[]) => void }) => (
    <button type="button" onClick={() => props.onChange(mockNextSelection)}>
      Choose spaces
    </button>
  ),
}));

const site = "https://example.atlassian.net";
const scope = {
  page_id: "123",
  page_title: "Architecture",
  space_key: "PLATFORM",
  include_descendants: true,
};

const platform = encodeConfluenceSource({
  url: `${site}/wiki/spaces/PLATFORM`,
  base_url: site,
  space_key: "PLATFORM",
  name: "Platform",
  page_scopes: [scope],
});
const marketing = encodeConfluenceSource({
  url: `${site}/wiki/spaces/MARKETING`,
  base_url: site,
  space_key: "MARKETING",
  name: "Marketing",
});

async function reachReviewWithSelection(selection: string[]) {
  mockNextSelection = selection;
  render(<ProjectOnboardingWizard initialOpen />);
  await screen.findByRole("heading", { name: "Type" });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(await screen.findByLabelText(/Project name/), {
    target: { value: "Example Project" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose spaces" }));
  // Advance through the remaining optional steps (e.g. auto-ingest) to review.
  for (let i = 0; i < 5 && !screen.queryByRole("button", { name: "Create project" }); i++) {
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  }
  return screen.findByRole("button", { name: "Create project" });
}

describe("onboarding Confluence sources", () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      let data: unknown = {};
      if (url === "/api/projects/onboarding-config") {
        data = {
          config: {
            steps: [
              {
                id: "confluence",
                title: "Confluence",
                provider: "source",
                source: "confluence",
                default_enabled: true,
              },
            ],
          },
        };
      } else if (url === "/api/dynamic-agents/teams") {
        data = [{ _id: "team-1", slug: "example-team", name: "Example Team" }];
      } else if (url === "/api/projects" && init?.method === "POST") {
        data = { project: { _id: "project-id", slug: "example-project" } };
      }
      return { ok: true, status: 200, json: async () => ({ data }) } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function createBody(): Record<string, unknown> {
    const post = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/projects" && (init as RequestInit)?.method === "POST",
    );
    return JSON.parse(String((post?.[1] as RequestInit).body));
  }

  it("summarizes each chosen space on the review step", async () => {
    await reachReviewWithSelection([platform, marketing]);

    expect(await screen.findByText("2 spaces")).toBeInTheDocument();
    expect(screen.getByText("Platform")).toBeInTheDocument();
    expect(screen.getByText("Marketing")).toBeInTheDocument();
  });

  it("uses the singular for a single chosen space", async () => {
    await reachReviewWithSelection([marketing]);

    expect(await screen.findByText("1 space")).toBeInTheDocument();
  });

  it("creates the project with confluence_spaces instead of confluence_url", async () => {
    const create = await reachReviewWithSelection([platform, marketing]);

    fireEvent.click(create);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => url === "/api/projects"),
      ).toBe(true),
    );

    const body = createBody();
    expect(body.confluence_spaces).toEqual([
      { slug: "platform", name: "Platform", space_key: "PLATFORM", base_url: site, page_scopes: [scope] },
      { slug: "marketing", name: "Marketing", space_key: "MARKETING", base_url: site },
    ]);
    expect(body).not.toHaveProperty("confluence_url");
    expect(body).not.toHaveProperty("confluence_page_scopes");
  });
});
