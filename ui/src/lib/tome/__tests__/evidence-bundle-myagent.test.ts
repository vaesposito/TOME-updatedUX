/** @jest-environment node */

const mockInsertEvidenceBundle = jest.fn();

jest.mock("@/lib/tome/agent-proxy", () => ({
  buildSnapshotFromProject: jest.fn(() => ({ project_id: "project-id" })),
}));
jest.mock("@/lib/tome/page-store", () => ({
  getPageStore: jest.fn(async () => ({ listPages: jest.fn(async () => ({})) })),
}));
jest.mock("@/lib/tome/page-templates-store", () => ({
  getAllPageTemplates: jest.fn(async () => []),
}));
jest.mock("../evaluation-store", () => {
  const actual = jest.requireActual("../evaluation-store");
  return {
    ...actual,
    insertEvidenceBundle: (...args: unknown[]) => mockInsertEvidenceBundle(...args),
  };
});

import { captureEvidenceBundle } from "../evidence-bundle";
import type { ProjectDocument } from "@/types/projects";

const project = {
  _id: "project-id",
  slug: "example-project",
  name: "Example project",
  title: "Example project",
  description: "",
  team_id: "example-team",
  team_slug: "example-team",
  team_name: "Example Team",
  owner_id: "owner@example.test",
  member_ids: [],
  domain: "example",
  labels: {},
  tags: [],
  status: "active",
  catalog: {},
  components: [],
  onboarding: {},
  integrations: {},
  sources: {},
  source: "manual",
  created_at: new Date(0),
  updated_at: new Date(0),
} as ProjectDocument & { _id: string };

describe("MyAgent evidence bundle capture", () => {
  beforeEach(() => jest.clearAllMocks());

  it("freezes received evidence with nonsecret deterministic provenance", async () => {
    const bundle = await captureEvidenceBundle({
      project,
      createdBy: "owner-subject",
      myAgentEvidence: {
        capabilities: ["sharepoint", "outlook"],
        status: "received",
        content: "  Account and document evidence.  ",
      },
    });

    const evidence = bundle.items.find((item) => item.kind === "myagent");
    expect(evidence).toMatchObject({
      canonical_uri: "myagent://webex/delegated?capabilities=outlook,sharepoint",
      content: "Account and document evidence.",
    });
    expect(mockInsertEvidenceBundle).toHaveBeenCalledWith(bundle);
  });

  it("does not freeze unavailable data and preserves the response size bound", async () => {
    const unavailable = await captureEvidenceBundle({
      project,
      createdBy: "owner-subject",
      myAgentEvidence: {
        capabilities: ["outlook"],
        status: "unavailable",
        content: "Do not persist this.",
      },
    });
    expect(unavailable.items.some((item) => item.kind === "myagent")).toBe(false);

    const oversized = await captureEvidenceBundle({
      project,
      createdBy: "owner-subject",
      myAgentEvidence: {
        capabilities: ["outlook"],
        status: "received",
        content: "x".repeat(8_001),
      },
    });
    expect(oversized.items.find((item) => item.kind === "myagent")?.content).toHaveLength(8_000);
  });
});
