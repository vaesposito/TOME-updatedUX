/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireInteractiveTomePrincipal = jest.fn();
const mockCanReadTomeProject = jest.fn();
const mockGetRunLedgerSummary = jest.fn();
const mockGetFetchLedgerEntries = jest.fn();
const mockResolveProject = jest.fn();
const mockIsTomeServerEnabled = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
}));
jest.mock("@/lib/tome/principal", () => ({
  requireInteractiveTomePrincipal: (...args: unknown[]) => mockRequireInteractiveTomePrincipal(...args),
}));
jest.mock("@/lib/tome/access", () => ({
  canReadTomeProject: (...args: unknown[]) => mockCanReadTomeProject(...args),
}));
jest.mock("@/lib/tome/fetch-ledger-store", () => ({
  getRunLedgerSummary: (...args: unknown[]) => mockGetRunLedgerSummary(...args),
  getFetchLedgerEntries: (...args: unknown[]) => mockGetFetchLedgerEntries(...args),
}));
jest.mock("@/lib/tome/internal-api", () => ({
  resolveProject: (...args: unknown[]) => mockResolveProject(...args),
}));
jest.mock("@/lib/tome/guard", () => ({
  isTomeServerEnabled: (...args: unknown[]) => mockIsTomeServerEnabled(...args),
}));

import { GET } from "../route";

function request(): NextRequest {
  return new NextRequest(
    new URL("/api/tome/fetch-ledger/run-1", "http://localhost:3000"),
    { headers: { "X-Caipe-Token": "tome_key" } },
  );
}

function ctx() {
  return { params: Promise.resolve({ runId: "run-1" }) };
}

const PROJECT = { _id: "proj-1", slug: "quantum" };
const SUMMARY = {
  run_id: "run-1",
  project_id: "proj-1",
  fetch_count: 2,
  success_count: 2,
  total_bytes_fetched: 100,
  updated_at: "2026-09-28T00:00:00.000Z",
};

describe("external fetch-ledger retrieval route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsTomeServerEnabled.mockReturnValue(true);
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: "user@example.com", name: "User", role: "user" },
      session: { sub: "oidc-sub-1" },
    });
    mockRequireInteractiveTomePrincipal.mockReturnValue(undefined);
    mockGetRunLedgerSummary.mockResolvedValue(SUMMARY);
    mockResolveProject.mockResolvedValue(PROJECT);
    mockCanReadTomeProject.mockResolvedValue(true);
    mockGetFetchLedgerEntries.mockResolvedValue([]);
  });

  it("returns the ledger and summary for an authorized caller", async () => {
    const response = await GET(request(), ctx());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.run_id).toBe("run-1");
    expect(body.summary).toEqual({ fetch_count: 2, success_count: 2, total_bytes_fetched: 100 });
    expect(mockCanReadTomeProject).toHaveBeenCalledWith("oidc-sub-1", PROJECT);
  });

  it("returns 401 when auth fails", async () => {
    mockGetAuthFromBearerOrSession.mockRejectedValue(new Error("unauthorized"));
    const response = await GET(request(), ctx());
    expect(response.status).toBe(401);
  });

  it("returns 404 when no ledger exists for the run", async () => {
    mockGetRunLedgerSummary.mockResolvedValue(null);
    const response = await GET(request(), ctx());
    expect(response.status).toBe(404);
  });

  it("returns 403 when the caller cannot read the project", async () => {
    mockCanReadTomeProject.mockResolvedValue(false);
    const response = await GET(request(), ctx());
    expect(response.status).toBe(403);
    expect(mockGetFetchLedgerEntries).not.toHaveBeenCalled();
  });
});
