/** @jest-environment node */
import { askMyAgentForRun } from "../myagent-tool";

const mockFindRun = jest.fn();
const mockUpdateRun = jest.fn();
const mockUpdateProject = jest.fn();
const mockCanWrite = jest.fn();
const mockResolveCredential = jest.fn();
const mockRequest = jest.fn();
const mockGetBundle = jest.fn();
const mockAppendEvidence = jest.fn();
jest.mock("@/lib/mongodb", () => ({ getCollection: async () => ({ updateOne: mockUpdateProject }) }));
jest.mock("../mongo-collections", () => ({ getTomeIngestRunsCollection: async () => ({ findOne: mockFindRun, updateOne: mockUpdateRun }) }));
jest.mock("../data-steward", () => ({ canWriteAs: (...args: unknown[]) => mockCanWrite(...args) }));
jest.mock("../myagent-webex", () => ({
  requestMyAgentEvidence: (...args: unknown[]) => mockRequest(...args),
  resolveMyAgentWebexCredential: (...args: unknown[]) => mockResolveCredential(...args),
}));
jest.mock("../evaluation-store", () => ({ getEvidenceBundle: (...args: unknown[]) => mockGetBundle(...args) }));
jest.mock("../evidence-bundle", () => ({
  captureEvidenceBundle: jest.fn(),
  appendMyAgentQuestionEvidence: (...args: unknown[]) => mockAppendEvidence(...args),
}));

const project = {
  _id: "project-1", slug: "example", title: "Example rollout", description: "Delivery readiness",
  sources: { myagent_consents: [{ subject: "owner-1", connectors: ["outlook", "sharepoint"], revision: "revision-1", granted_at: "2026-01-01T00:00:00Z" }] },
} as unknown as Parameters<typeof askMyAgentForRun>[0];
const baseRun = {
  _id: "run-1", project_id: "project-1", status: "running", triggered_by: "manual",
  triggered_by_sub: "owner-1", myagent_interactive_authorized: true, myagent_tool_enabled: true,
  myagent_consent_revision: "revision-1", myagent_allowed_sources: ["outlook"], evidence_bundle_id: "bundle-1",
};
const question = "Who owns the rollout blocker discussed this week?";
const evidence = { capabilities: ["outlook"], status: "received", content: "The delivery lead owns the blocker." };

beforeEach(() => {
  jest.resetAllMocks();
  mockFindRun.mockResolvedValue({ ...baseRun });
  mockUpdateRun.mockResolvedValue({ matchedCount: 1 });
  mockUpdateProject.mockResolvedValue({ matchedCount: 1 });
  mockCanWrite.mockResolvedValue(true);
  mockResolveCredential.mockResolvedValue({ available: true, accessToken: "private-token" });
  mockRequest.mockResolvedValue(evidence);
  mockGetBundle.mockResolvedValue({ _id: "bundle-1", project_id: "project-1", items: [] });
  mockAppendEvidence.mockResolvedValue({ _id: "bundle-2", content_hash: "hash-2" });
});

it("binds research to the stored owner/scope and gates private writes before returning evidence", async () => {
  await expect(askMyAgentForRun(project, "run-1", question)).resolves.toEqual(evidence);
  expect(mockResolveCredential).toHaveBeenCalledWith("owner-1");
  expect(mockRequest).toHaveBeenCalledWith({
    accessToken: "private-token", capabilities: ["outlook"], question,
    context: { projectTitle: project.title, projectDescription: project.description },
  });
  expect(mockUpdateRun).toHaveBeenCalledWith({ _id: "run-1" }, { $set: { myagent_evidence_received: true } });
  expect(mockAppendEvidence).toHaveBeenCalledWith(expect.objectContaining({ _id: "bundle-1" }), question, evidence);
  expect(mockUpdateRun).toHaveBeenLastCalledWith({ _id: "run-1" }, { $set: { myagent_question_in_flight: false } });
});

it.each([
  { status: "completed" }, { triggered_by: "auto" }, { myagent_interactive_authorized: false },
  { myagent_tool_enabled: false }, { triggered_by_sub: "" },
  { dispatch: { endpoint: "/compact" } }, { dispatch: { sourceScope: "webex_meetings" } },
])("rejects runs that cannot delegate: %j", async (override) => {
  mockFindRun.mockResolvedValue({ ...baseRun, ...override });
  await expect(askMyAgentForRun(project, "run-1", question)).rejects.toMatchObject({ statusCode: 403 });
  expect(mockRequest).not.toHaveBeenCalled();
});

it("rejects a run belonging to another project", async () => {
  mockFindRun.mockResolvedValue(null);
  await expect(askMyAgentForRun(project, "other-run", question)).rejects.toBeDefined();
  expect(mockFindRun).toHaveBeenCalledWith({ _id: "other-run", project_id: "project-1" });
  expect(mockRequest).not.toHaveBeenCalled();
});

it.each(["", " ", "x".repeat(2001), null])("rejects invalid questions before credential lookup", async (value) => {
  await expect(askMyAgentForRun(project, "run-1", value)).rejects.toBeDefined();
  expect(mockResolveCredential).not.toHaveBeenCalled();
});

it("does not send after the owner loses write access", async () => {
  mockCanWrite.mockResolvedValue(false);
  await expect(askMyAgentForRun(project, "run-1", question)).rejects.toBeDefined();
  expect(mockRequest).not.toHaveBeenCalled();
});

it("does not send after consent changes", async () => {
  mockFindRun.mockResolvedValue({ ...baseRun, myagent_consent_revision: "older-revision" });
  await expect(askMyAgentForRun(project, "run-1", question)).rejects.toBeDefined();
  expect(mockRequest).not.toHaveBeenCalled();
});

it("does not send when the atomic count/in-flight reservation is rejected", async () => {
  mockUpdateRun.mockResolvedValue({ matchedCount: 0 });
  await expect(askMyAgentForRun(project, "run-1", question)).rejects.toBeDefined();
  expect(mockRequest).not.toHaveBeenCalled();
  expect(mockUpdateRun.mock.calls[0][0]).toMatchObject({
    myagent_question_in_flight: { $ne: true },
    $or: [{ myagent_question_count: { $exists: false } }, { myagent_question_count: { $lt: 3 } }],
  });
});

it("honors revocation winning immediately before send", async () => {
  mockUpdateProject.mockResolvedValue({ matchedCount: 0 });
  await expect(askMyAgentForRun(project, "run-1", question)).rejects.toBeDefined();
  expect(mockRequest).not.toHaveBeenCalled();
  expect(mockUpdateRun).toHaveBeenLastCalledWith({ _id: "run-1" }, { $set: { myagent_question_in_flight: false } });
});

it("discards a reply when consent is revoked while waiting", async () => {
  mockUpdateProject.mockResolvedValueOnce({ matchedCount: 1 }).mockResolvedValueOnce({ matchedCount: 0 });
  await expect(askMyAgentForRun(project, "run-1", question)).resolves.toMatchObject({ status: "unavailable" });
  expect(mockAppendEvidence).not.toHaveBeenCalled();
});

it("uses the latest bundle after acquiring the reservation so earlier answers are retained", async () => {
  mockFindRun.mockResolvedValueOnce(baseRun).mockResolvedValue({ ...baseRun, evidence_bundle_id: "latest-bundle" });
  await askMyAgentForRun(project, "run-1", question);
  expect(mockGetBundle).toHaveBeenCalledWith("latest-bundle");
});
