const mockCollectForwardedCredentials = jest.fn();
const mockResolveRooms = jest.fn();

jest.mock("@/lib/projects/onboarding-providers", () => ({
  collectForwardedCredentials: (...args: unknown[]) =>
    mockCollectForwardedCredentials(...args),
}));
jest.mock("../webex-room-execution", () => ({
  resolveWebexRoomExecution: (...args: unknown[]) => mockResolveRooms(...args),
}));
jest.mock("../bhag", () => ({
  resolveAreaChildren: jest.fn(),
  resolveBhagChildren: jest.fn(),
}));
jest.mock("../access", () => ({
  listReadableTomeProjects: jest.fn(),
}));
jest.mock("../data-steward", () => ({
  tomeSessionSubject: jest.fn(),
}));
jest.mock("../page-store", () => ({
  getPageStore: jest.fn(),
}));

import {
  buildIngestRequest,
  buildSnapshotFromProject,
  resolveProjectCredentials,
} from "../agent-proxy";
import type { ProjectDocument, ProjectType } from "@/types/projects";

function synthesizedProject(type: ProjectType): ProjectDocument & { _id: string } {
  return {
    _id: `${type}-id`,
    type,
    slug: `${type}-example`,
    name: `${type} example`,
    title: `${type} example`,
    description: "Example synthesis",
    team_id: "team-id",
    team_slug: "example-team",
    team_name: "Example team",
    owner_id: "test-user@example.com",
    member_ids: [],
    domain: "example",
    labels: {},
    tags: [],
    status: "active",
    catalog: {} as ProjectDocument["catalog"],
    components: [],
    onboarding: {},
    integrations: {},
    sources: {
      repos: ["example/repository"],
      confluence_url: "https://example.atlassian.net/wiki/spaces/EXAMPLE",
      webex_rooms: [
        {
          slug: "example-room",
          name: "Example room",
          room_id: "room-id",
        },
      ],
    },
    source: "manual",
    created_at: new Date(),
    updated_at: new Date(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCollectForwardedCredentials.mockResolvedValue({
    github: { access_token: "github-token" },
    webex: { access_token: "personal-webex-token" },
  });
  mockResolveRooms.mockResolvedValue({ checks: [{ name: "Example room", mode: "managed", available: true }],
    roomTokens: { "room-id": "bound-owner-token" } });
});

it.each(["manual", "auto"] as const)("sends saved SharePoint IDs through the shared %s ingest contract without app credentials", (triggeredBy) => {
  const project = synthesizedProject("project");
  project.sources = { sharepoint_documents: [{ drive_id: "drive-1", item_id: "item-1", name: "Example.pptx" }] };
  const request = buildIngestRequest(project, { runId: "run-1", reportId: "report-1", seed: null, isGreenfield: false, triggeredBy });
  expect(request.connector_data).toEqual({ sharepoint: { documents: [{ drive_id: "drive-1", item_id: "item-1" }] } });
  expect(request.credentials).toEqual({});
});

it("excludes SharePoint from isolated recurring-meeting ingests", () => {
  const project = synthesizedProject("project");
  project.sources = { sharepoint_documents: [{ drive_id: "drive-1", item_id: "item-1", name: "Example.pptx" }] };
  expect(buildIngestRequest(project, { runId: "run-1", reportId: "report-1", seed: null, isGreenfield: false,
    sourceScope: "webex_meetings", sharepointDocuments: [{ drive_id: "drive-1", item_id: "one-off", name: "Context.pdf" }] }).connector_data).toEqual({});
});

it("requires folder resolution and forwards only document IDs, never the folder as a file", () => {
  const project = synthesizedProject("project");
  project.sources = { sharepoint_documents: [{ kind: "folder", drive_id: "drive-1", item_id: "folder-1", name: "Example folder" }] };
  const options = { runId: "run-1", reportId: "report-1", seed: null, isGreenfield: false };
  expect(() => buildIngestRequest(project, options)).toThrow("must be resolved");
  expect(buildIngestRequest(project, { ...options, resolvedSharepointDocuments: [{ drive_id: "drive-1", item_id: "file-1", name: "Example.pdf" }] })
    .connector_data.sharepoint).toEqual({ documents: [{ drive_id: "drive-1", item_id: "file-1" }] });
  expect(buildIngestRequest(project, { ...options, sourceScope: "webex_meetings" }).connector_data).toEqual({});
});

it.each(["project", "area", "bhag"] as const)("includes one-off documents in %s runs without attaching them to the project", (type) => {
  const project = synthesizedProject(type);
  const saved = { drive_id: "drive-1", item_id: "saved", name: "Saved.pptx" };
  const context = { drive_id: "drive-1", item_id: "context", name: "Context.pdf" };
  project.sources!.sharepoint_documents = [saved];
  const request = buildIngestRequest(project, { runId: "run-1", reportId: "report-1", seed: null, isGreenfield: false,
    sharepointDocuments: [saved, context], connectorData: { webex: { meetings: [{ id: "meeting-1" }] } } });
  expect(request.connector_data).toEqual({ sharepoint: { documents: [
    { drive_id: "drive-1", item_id: "saved" }, { drive_id: "drive-1", item_id: "context" },
  ] }, webex: { meetings: [{ id: "meeting-1" }] } });
  expect(project.sources!.sharepoint_documents).toEqual([saved]);
  expect(buildIngestRequest(project, { runId: "next-run", reportId: "next-report", seed: null, isGreenfield: false,
    triggeredBy: "auto" }).connector_data).toEqual({ sharepoint: { documents: [{ drive_id: "drive-1", item_id: "saved" }] } });
});

it("can ingest one-off documents without any saved SharePoint source", () => {
  const request = buildIngestRequest(synthesizedProject("project"), { runId: "run-1", reportId: "report-1", seed: null,
    isGreenfield: false, sharepointDocuments: [{ drive_id: "drive-1", item_id: "context", name: "Context.pdf" }] });
  expect(request.connector_data.sharepoint).toEqual({ documents: [{ drive_id: "drive-1", item_id: "context" }] });
});

it("forwards scoped room tokens without replacing the caller's meeting token", async () => {
  const project = synthesizedProject("project");
  await expect(resolveProjectCredentials(project, "caller", { purpose: "ingest" })).resolves.toEqual({
    github: { access_token: "github-token" },
    webex: { access_token: "personal-webex-token", room_tokens: '{"room-id":"bound-owner-token"}' },
  });
  expect(mockResolveRooms).toHaveBeenCalledWith(expect.objectContaining({ sources: project.sources, subject: "caller", purpose: "ingest" }));
});

it("works without the caller having any Webex connection", async () => {
  mockCollectForwardedCredentials.mockResolvedValue({});
  await expect(resolveProjectCredentials(synthesizedProject("project"), "caller", { purpose: "ingest" }))
    .resolves.toEqual({ webex: { room_tokens: '{"room-id":"bound-owner-token"}' } });
});

it.each(["chat", "meeting"] as const)("never resolves delegated credentials for %s", async (purpose) => {
  await expect(resolveProjectCredentials(synthesizedProject("project"), "caller",
    purpose === "chat" ? { purpose } : { purpose: "ingest", sourceScope: "webex_meetings" }))
    .resolves.toEqual({ github: { access_token: "github-token" }, webex: { access_token: "personal-webex-token" } });
  expect(mockResolveRooms).not.toHaveBeenCalled();
});

it("blocks dispatch rather than silently skipping a failed room", async () => {
  mockResolveRooms.mockResolvedValue({ checks: [{ name: "Room A", mode: "managed", available: false, detail: "Managed account lost access" }], roomTokens: {} });
  await expect(resolveProjectCredentials(synthesizedProject("project"), "caller", { purpose: "ingest" }))
    .rejects.toThrow("Room A: Managed account lost access");
});

it("retains personal-source access errors instead of aborting other sources or borrowing another user's token", async () => {
  mockResolveRooms.mockResolvedValue({ checks: [{ name: "Room A", mode: "personal", available: false }], roomTokens: { "room-id": "personal-webex-token" } });
  await expect(resolveProjectCredentials(synthesizedProject("project"), "caller", { purpose: "ingest" }))
    .resolves.toMatchObject({ webex: { access_token: "personal-webex-token" } });
});

it("does not make a credential-less scheduled personal run appear connected", async () => {
  mockCollectForwardedCredentials.mockResolvedValue({});
  mockResolveRooms.mockResolvedValue({ checks: [{ name: "Room A", mode: "personal", available: false }], roomTokens: {} });
  await expect(resolveProjectCredentials(synthesizedProject("project"), "owner", { purpose: "ingest" })).resolves.toEqual({});
});

describe.each(["bhag", "area"] as const)(
  "buildSnapshotFromProject(%s)",
  (type) => {
    it("preserves directly attached sources for synthesis", () => {
      const snapshot = buildSnapshotFromProject(synthesizedProject(type));

      expect(snapshot.repos).toEqual([
        {
          slug: "repository",
          url: "https://github.com/example/repository",
          default_branch: "main",
        },
      ]);
      expect(snapshot.confluence_spaces).toEqual([
        {
          slug: "example",
          name: "EXAMPLE",
          space_key: "EXAMPLE",
          base_url: "https://example.atlassian.net",
        },
      ]);
      expect(snapshot.webex_rooms).toEqual([
        {
          slug: "example-room",
          name: "Example room",
          room_id: "room-id",
        },
      ]);
    });
  },
);

it("forwards a Confluence page-tree scope to the agent snapshot", () => {
  const project = synthesizedProject("project");
  project.sources = {
    ...project.sources,
    confluence_url:
      "https://example.atlassian.net/wiki/spaces/EXAMPLE/pages/123/Overview",
    confluence_page_scope: {
      page_id: "123",
      page_title: "Overview",
      space_key: "EXAMPLE",
      include_descendants: true,
    },
  };

  expect(buildSnapshotFromProject(project).confluence_spaces).toEqual([
    {
      slug: "example",
      name: "EXAMPLE",
      space_key: "EXAMPLE",
      base_url: "https://example.atlassian.net",
      root_page_id: "123",
      root_page_title: "Overview",
      include_descendants: true,
      page_scopes: [
        {
          page_id: "123",
          page_title: "Overview",
          include_descendants: true,
        },
      ],
    },
  ]);
});

it("forwards multiple Confluence page roots to one space snapshot", () => {
  const project = synthesizedProject("project");
  project.sources = {
    ...project.sources,
    confluence_url: "https://example.atlassian.net/wiki/spaces/EXAMPLE",
    confluence_page_scopes: [
      {
        page_id: "123",
        page_title: "Overview",
        space_key: "EXAMPLE",
        include_descendants: true,
      },
      {
        page_id: "456",
        page_title: "Runbook",
        space_key: "EXAMPLE",
        include_descendants: false,
      },
    ],
  };

  expect(buildSnapshotFromProject(project).confluence_spaces).toEqual([
    expect.objectContaining({
      slug: "example",
      page_scopes: [
        {
          page_id: "123",
          page_title: "Overview",
          include_descendants: true,
        },
        {
          page_id: "456",
          page_title: "Runbook",
          include_descendants: false,
        },
      ],
    }),
  ]);
});

it("forwards stable GitHub identity and canonical branch metadata", () => {
  const project = synthesizedProject("project");
  project.sources = {
    ...project.sources,
    github_repos: [
      {
        id: 42,
        node_id: "repository-node",
        full_name: "example/renamed-repository",
        html_url: "https://github.com/example/renamed-repository",
        default_branch: "trunk",
      },
    ],
  };

  expect(buildSnapshotFromProject(project).repos).toEqual([
    {
      repo_id: 42,
      slug: "renamed-repository",
      url: "https://github.com/example/renamed-repository",
      default_branch: "trunk",
    },
  ]);
});

it("excludes every attached project source from a Webex meeting-only ingest", () => {
  const request = buildIngestRequest(synthesizedProject("project"), {
    runId: "run-1",
    reportId: "report-1",
    seed: null,
    isGreenfield: false,
    sourceScope: "webex_meetings",
    connectorData: {
      webex: {
        meetings: [{ id: "meeting-1", title: "Weekly sync", start: "2026-09-03T10:00:00Z" }],
      },
    },
  });

  expect(request.snapshot.repos).toEqual([]);
  expect(request.snapshot.confluence_spaces).toEqual([]);
  expect(request.snapshot.webex_rooms).toEqual([]);
  expect(request.connector_data).toEqual({
    webex: {
      meetings: [{ id: "meeting-1", title: "Weekly sync", start: "2026-09-03T10:00:00Z" }],
    },
  });
});

it("does not forward a bridge-only Webex credential to the agent", () => {
  const request = buildIngestRequest(synthesizedProject("project"), {
    runId: "run-1",
    reportId: "report-1",
    seed: null,
    isGreenfield: false,
    credentials: {
      github: { access_token: "github-token" },
      webex: { access_token: "personal-webex-token" },
    },
    omitWebexCredential: true,
    myAgentEvidence: {
      capabilities: ["outlook"],
      status: "received",
      content: "Delegated evidence",
    },
  });

  expect(request.credentials).toEqual({ github: { access_token: "github-token" } });
  expect(request.myagent_evidence).toEqual({
    capabilities: ["outlook"],
    status: "received",
    content: "Delegated evidence",
  });
});

it.each(["area", "bhag"] as const)(
  "excludes child-project context from a %s meeting-only ingest",
  (projectType) => {
    const request = buildIngestRequest(synthesizedProject(projectType), {
      runId: "run-1",
      reportId: "report-1",
      seed: null,
      isGreenfield: false,
      sourceScope: "webex_meetings",
      childProjects: [
        { project_id: "child-1", slug: "child-one", name: "Child one" },
      ],
      readableProjects: [
        { project_id: "child-1", slug: "child-one", name: "Child one" },
      ],
      connectorData: {
        webex: {
          meetings: [
            {
              id: "meeting-1",
              title: "Leadership sync",
              start: "2026-09-03T10:00:00Z",
            },
          ],
        },
      },
    });

    expect(request.snapshot.project_type).toBe(projectType);
    expect(request.snapshot.child_projects).toEqual([]);
    expect(request.snapshot.readable_projects).toEqual([]);
  },
);
