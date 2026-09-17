/** @jest-environment node */

import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api-middleware";

const mockLoadTomeProject = jest.fn();
const mockRequireTomeEditor = jest.fn();
const mockRequireTomeDataSteward = jest.fn();
const mockAddTracker = jest.fn();
const mockEnableTracker = jest.fn();
const mockRemoveTracker = jest.fn();
const mockReadCustomTrackers = jest.fn();
const mockListTrackedLabels = jest.fn();
const mockReadLabelSettings = jest.fn();

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
  requireTomeEditor: (...args: unknown[]) => mockRequireTomeEditor(...args),
  requireTomeDataSteward: (...args: unknown[]) => mockRequireTomeDataSteward(...args),
}));
jest.mock("@/lib/tome/issue-tracker-store", () => ({
  addTomeCustomIssueTracker: (...args: unknown[]) => mockAddTracker(...args),
  enableTomeIssueTracker: (...args: unknown[]) => mockEnableTracker(...args),
  removeTomeCustomIssueTracker: (...args: unknown[]) => mockRemoveTracker(...args),
  removeTomeIssueTracker: (...args: unknown[]) => mockRemoveTracker(...args),
  listTomeTrackedIssueLabels: (...args: unknown[]) => mockListTrackedLabels(...args),
  readTomeCustomIssueTrackers: (...args: unknown[]) => mockReadCustomTrackers(...args),
  readTomeIssueLabelSettings: (...args: unknown[]) => mockReadLabelSettings(...args),
}));

import { DELETE, GET, POST } from "../route";

const endpoint = "http://example.test/api/tome/projects/example-project/issue-trackers";
const context = { params: Promise.resolve({ slug: "example-project" }) };

describe("TOME issue trackers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadTomeProject.mockResolvedValue({
      projectId: "project-1",
      canEdit: true,
      canManageSteward: false,
      isDataSteward: true,
    });
    mockReadLabelSettings.mockResolvedValue({
      labels: {
        critical: { title: "Critical", suffix: "critical" },
        "needs-attention": { title: "Needs Attention", suffix: "needs attention" },
        decision: { title: "Decisions", suffix: "decision" },
      },
      legacy_labels: {},
    });
    mockListTrackedLabels.mockResolvedValue([
      { id: "critical", label: "critical", title: "Critical" },
      { id: "needs-attention", label: "needs attention", title: "Needs Attention" },
      { id: "decision", label: "decision", title: "Decisions" },
      { id: "security-review", label: "security-review", title: "Security Review" },
    ]);
    mockReadCustomTrackers.mockResolvedValue(["security-review"]);
  });

  it("returns project-wide custom trackers to readable users", async () => {
    const response = await GET(new NextRequest(endpoint), context);

    expect(mockListTrackedLabels).toHaveBeenCalledWith(["project-1"]);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        can_remove: true,
        trackers: expect.arrayContaining([{
          id: "critical",
          label: "critical",
          title: "Critical",
        }]),
      },
    });
  });

  it("creates a tracker from an unprefixed suffix", async () => {
    const response = await POST(new NextRequest(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suffix: "security-review" }),
    }), context);

    expect(mockRequireTomeEditor).toHaveBeenCalled();
    expect(mockAddTracker).toHaveBeenCalledWith("project-1", "security-review");
    expect(mockListTrackedLabels).toHaveBeenCalledWith(["project-1"]);
    expect(response.status).toBe(200);
  });

  it("removes a custom project tracker", async () => {
    const response = await DELETE(new NextRequest(endpoint, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "security-review" }),
    }), context);

    expect(mockRequireTomeDataSteward).toHaveBeenCalled();
    expect(mockReadCustomTrackers).toHaveBeenCalledWith("project-1");
    expect(mockRemoveTracker).toHaveBeenCalledWith("project-1", "security-review");
    expect(response.status).toBe(200);
  });

  it("removes a built-in tracker for the project's data steward", async () => {

    const response = await DELETE(new NextRequest(endpoint, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "critical" }),
    }), context);

    expect(mockRequireTomeDataSteward).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(mockRemoveTracker).toHaveBeenCalledWith("project-1", "critical");
  });

  it("does not allow a Tome admin to remove a tracker", async () => {
    mockLoadTomeProject.mockResolvedValue({
      projectId: "project-1",
      canEdit: true,
      canManageSteward: true,
      isDataSteward: false,
    });
    mockRequireTomeDataSteward.mockImplementation(() => {
      throw new ApiError("data steward required", 403, "DATA_STEWARD_REQUIRED");
    });

    const response = await DELETE(new NextRequest(endpoint, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "critical" }),
    }), context);

    expect(response.status).toBe(403);
    expect(mockRemoveTracker).not.toHaveBeenCalled();
  });

  it("restores a removed built-in tracker through the add dialog", async () => {
    const response = await POST(new NextRequest(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suffix: "critical" }),
    }), context);

    expect(response.status).toBe(200);
    expect(mockEnableTracker).toHaveBeenCalledWith("project-1", "critical");
    expect(mockAddTracker).not.toHaveBeenCalled();
  });

  it("rejects prefixes and unsupported label characters", async () => {
    const response = await POST(new NextRequest(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suffix: "tome:security review" }),
    }), context);

    expect(response.status).toBe(400);
    expect(mockAddTracker).not.toHaveBeenCalled();
  });

  it("creates an unprefixed custom tracker by default", async () => {
    mockReadLabelSettings.mockResolvedValue({
      labels: {
        critical: { title: "Critical", suffix: "critical" },
        "needs-attention": { title: "Needs Attention", suffix: "needs attention" },
        decision: { title: "Decisions", suffix: "decision" },
      },
      legacy_labels: {},
    });

    const response = await POST(new NextRequest(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suffix: "security-review" }),
    }), context);

    expect(response.status).toBe(200);
    expect(mockAddTracker).toHaveBeenCalledWith("project-1", "security-review");
    await expect(response.json()).resolves.toMatchObject({ data: { trackers: expect.any(Array) } });
  });
});
