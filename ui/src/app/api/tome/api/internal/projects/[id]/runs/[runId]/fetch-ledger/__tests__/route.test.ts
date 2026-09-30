/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockRequireAgentToken = jest.fn();
const mockResolveProject = jest.fn();
const mockInsertFetchLedgerEntry = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  const { ApiError } = jest.requireActual("@/lib/api-error");
  return {
    ApiError,
    withErrorHandler:
      (handler: (...args: unknown[]) => unknown) =>
      async (...args: unknown[]) => {
        try {
          return await handler(...args);
        } catch (error) {
          const apiError = error as { statusCode?: number; message?: string; code?: string };
          return Response.json(
            { error: apiError.message ?? "Internal server error", code: apiError.code },
            { status: apiError.statusCode ?? 500 },
          );
        }
      },
  };
});

jest.mock("@/lib/tome/internal-api", () => ({
  requireAgentToken: (...args: unknown[]) => mockRequireAgentToken(...args),
  resolveProject: (...args: unknown[]) => mockResolveProject(...args),
}));

jest.mock("@/lib/tome/fetch-ledger-store", () => ({
  insertFetchLedgerEntry: (...args: unknown[]) => mockInsertFetchLedgerEntry(...args),
}));

import { POST } from "../route";

const PROJECT = { _id: "proj-1", slug: "quantum" };

function postRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    new URL(
      "/api/tome/api/internal/projects/proj-1/runs/run-1/fetch-ledger",
      "http://localhost:3000",
    ),
    {
      method: "POST",
      headers: { authorization: "Bearer agent-tok", "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function ctx() {
  return { params: Promise.resolve({ id: "proj-1", runId: "run-1" }) };
}

function successBody(overrides: Record<string, unknown> = {}) {
  return {
    connector: "github",
    tool_name: "github_get_issue",
    tool_args: { repo: "org/repo", number: 42 },
    canonical_uri: "github://org/repo/issues/42",
    status: "success",
    content: "issue body",
    content_hash: "abc123",
    ...overrides,
  };
}

describe("internal fetch-ledger callback route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAgentToken.mockReturnValue(undefined);
    mockResolveProject.mockResolvedValue(PROJECT);
    mockInsertFetchLedgerEntry.mockResolvedValue(undefined);
  });

  it("persists a valid successful entry and returns 204", async () => {
    const response = await POST(postRequest(successBody()), ctx());

    expect(response.status).toBe(204);
    expect(mockInsertFetchLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        run_id: "run-1",
        project_id: "proj-1",
        connector: "github",
        canonical_uri: "github://org/repo/issues/42",
        status: "success",
        content: "issue body",
        content_hash: "abc123",
      }),
    );
  });

  it("persists a valid failed entry with no content", async () => {
    const response = await POST(
      postRequest(
        successBody({ status: "error", content: undefined, content_hash: undefined, error_message: "HTTP 404" }),
      ),
      ctx(),
    );

    expect(response.status).toBe(204);
    expect(mockInsertFetchLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", content: null, content_hash: null, error_message: "HTTP 404" }),
    );
  });

  it("rejects a body missing required fields", async () => {
    const response = await POST(postRequest({ tool_name: "github_get_issue" }), ctx());
    expect(response.status).toBe(400);
    expect(mockInsertFetchLedgerEntry).not.toHaveBeenCalled();
  });

  it("rejects a successful entry with no content", async () => {
    const response = await POST(postRequest(successBody({ content: undefined, content_hash: undefined })), ctx());
    expect(response.status).toBe(400);
  });

  it("rejects an un-redacted, non-allowlisted argument (defense in depth)", async () => {
    const response = await POST(
      postRequest(successBody({ tool_args: { repo: "org/repo", query: "raw sensitive search text" } })),
      ctx(),
    );
    expect(response.status).toBe(400);
    expect(mockInsertFetchLedgerEntry).not.toHaveBeenCalled();
  });

  it("accepts a properly redacted non-allowlisted argument", async () => {
    const response = await POST(
      postRequest(
        successBody({ tool_args: { repo: "org/repo", query: "[redacted:27-char value]" } }),
      ),
      ctx(),
    );
    expect(response.status).toBe(204);
  });

  it("requires the agent token", async () => {
    mockRequireAgentToken.mockImplementation(() => {
      const { ApiError } = jest.requireActual("@/lib/api-error");
      throw new ApiError("Invalid agent token", 401, "AGENT_UNAUTHORIZED");
    });
    const response = await POST(postRequest(successBody()), ctx());
    expect(response.status).toBe(401);
  });
});
