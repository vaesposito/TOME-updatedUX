/** @jest-environment node */

import {
  getMyAgentWebexConfig,
  requestMyAgentEvidence,
  resolveMyAgentWebexCredential,
} from "../myagent-webex";

const mockListConnections = jest.fn();
const mockRefreshConnection = jest.fn();
jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getProviderConnectionService: jest.fn(async () => ({
    listConnections: mockListConnections,
    refreshConnection: mockRefreshConnection,
  })),
}));

const MYAGENT_ENV = {
  TOME_MYAGENT_ENABLED: "true",
  TOME_MYAGENT_WEBEX_EMAIL: "myagent@example.com",
  TOME_MYAGENT_POLL_INTERVAL_MS: "500",
  TOME_MYAGENT_REPLY_TIMEOUT_MS: "5000",
};
const context = { projectTitle: "Example rollout", projectDescription: "Move the reporting service to the new platform." };
const question = "What rollout blockers did the delivery team raise this week, and who owns the next steps?";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: string | URL | Request): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

describe("MyAgent Webex bridge", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(process.env, MYAGENT_ENV);
    mockListConnections.mockReset().mockResolvedValue([]);
    mockRefreshConnection.mockReset().mockResolvedValue({ accessToken: "dedicated-token" });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("resolves only the caller's dedicated MyAgent connection when both providers are connected", async () => {
    const dedicated = { id: "myagent-connection", provider: "webex_myagent", status: "connected",
      grantedScopes: ["spark:kms", "spark:messages_read", "spark:messages_write"] };
    mockListConnections.mockResolvedValue([
      { id: "general-connection", provider: "webex", status: "connected" },
      dedicated,
    ]);
    await expect(resolveMyAgentWebexCredential("user-1")).resolves.toEqual({
      available: true, accessToken: "dedicated-token", connection: dedicated,
    });
    expect(mockListConnections).toHaveBeenCalledWith({ type: "user", id: "user-1" });
    expect(mockRefreshConnection).toHaveBeenCalledTimes(1);
    expect(mockRefreshConnection).toHaveBeenCalledWith("myagent-connection");
  });

  it("does not fall back to general, managed, or meeting Webex connections", async () => {
    mockListConnections.mockResolvedValue(["webex", "webex_messaging", "webex_pam"].map((provider) => ({
      id: provider, provider, status: "connected",
      grantedScopes: ["spark:kms", "spark:messages_read", "spark:messages_write"],
    })));
    await expect(resolveMyAgentWebexCredential("user-1")).resolves.toMatchObject({
      available: false, fixableByUser: true, reason: expect.stringContaining("MyAgent (Webex)"),
    });
    expect(mockRefreshConnection).not.toHaveBeenCalled();
  });

  it.each(["spark:kms", "spark:messages_read", "spark:messages_write"])(
    "requires %s on the dedicated connection", async (missingScope) => {
      mockListConnections.mockResolvedValue([{
        id: "myagent-connection", provider: "webex_myagent", status: "connected",
        grantedScopes: ["spark:kms", "spark:messages_read", "spark:messages_write"].filter((scope) => scope !== missingScope),
      }]);
      await expect(resolveMyAgentWebexCredential("user-1")).resolves.toMatchObject({ available: false, fixableByUser: true });
      expect(mockRefreshConnection).not.toHaveBeenCalled();
    },
  );

  it("does not use a disconnected dedicated connection", async () => {
    mockListConnections.mockResolvedValue([{ id: "myagent-connection", provider: "webex_myagent", status: "revoked" }]);
    await expect(resolveMyAgentWebexCredential("user-1")).resolves.toMatchObject({ available: false });
    expect(mockRefreshConnection).not.toHaveBeenCalled();
  });

  it("sends only the selected integrations and accepts only a correlated MyAgent reply", async () => {
    const fetchMock = jest.fn(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/messages") {
          expect(init).toEqual(
            expect.objectContaining({
              method: "POST",
              headers: expect.objectContaining({
                Authorization: "Bearer user-webex-token",
              }),
            }),
          );
          return jsonResponse({ id: "ask-1" });
        }

        expect(url.pathname).toBe("/v1/messages/direct");
        expect(url.searchParams.get("personEmail")).toBe("myagent@example.com");
        expect(url.searchParams.get("max")).toBe("100");
        return jsonResponse({
          items: [
            {
              id: "wrong-sender",
              personEmail: "untrusted@example.com",
              parentId: "ask-1",
              markdown: "Untrusted evidence",
            },
            {
              id: "wrong-parent",
              personEmail: "myagent@example.com",
              parentId: "unrelated-ask",
              markdown: "Wrong thread",
            },
            {
              id: "acknowledgement",
              personEmail: "myagent@example.com",
              parentId: "ask-1",
              markdown: "Working on it.",
            },
            {
              id: "thread-parent",
              parentId: "ask-1",
            },
            {
              id: "answer",
              personEmail: "myagent@example.com",
              parentId: "thread-parent",
              created: "2026-09-15T10:00:00.000Z",
              markdown: "Outlook and SharePoint evidence",
            },
          ],
        });
      },
    );

    const result = await requestMyAgentEvidence({
      accessToken: "user-webex-token",
      context, question,
      capabilities: ["sharepoint", "outlook", "sharepoint"],
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result).toEqual({
      capabilities: ["outlook", "sharepoint"],
      status: "received",
      content: "Outlook and SharePoint evidence",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const sentBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sentBody).toEqual(
      expect.objectContaining({ toPersonEmail: "myagent@example.com" }),
    );
    expect(sentBody.markdown.startsWith(question)).toBe(true);
    expect(sentBody.markdown).toContain('project context: "Example rollout"');
    expect(sentBody.markdown).toContain(context.projectDescription);
    expect(sentBody.markdown).toContain("Please look in Outlook, SharePoint.");
    expect(sentBody.markdown).not.toContain("connector");
    expect(sentBody.markdown).not.toContain("TOME");
    expect(sentBody.markdown).not.toContain("Salesforce");
    expect(sentBody.markdown).not.toContain("TOME Project");
    expect(sentBody.markdown).toContain("Findings for the request");
    expect(sentBody.markdown).toContain("Project relevance");
    expect(sentBody.markdown).toContain("even if it does not mention the project");
  });

  it("does not contact Webex when no integration was selected", async () => {
    const fetchMock = jest.fn();

    await expect(
      requestMyAgentEvidence({
        accessToken: "user-webex-token",
        context, question,
        capabilities: [],
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).resolves.toEqual({
      capabilities: [],
      status: "unavailable",
      detail: "No MyAgent request categories were selected.",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the original seed alongside the agent question and separates project relevance", async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({}, 400));
    await requestMyAgentEvidence({
      accessToken: "user-webex-token", capabilities: ["outlook"], question: "Which messages need a response?",
      context: { ...context, seedInstruction: "Summarize my unread emails from yesterday." }, fetchImpl: fetchMock,
    });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body).markdown;
    expect(sent).toContain("User request: Summarize my unread emails from yesterday.");
    expect(sent).toContain("Which messages need a response?");
    expect(sent).toContain("This project name may not appear in those sources");
    expect(sent).toContain("no direct project match was found");
    expect(sent).not.toContain("Include only clear matches to this project");
  });

  it("returns an explicit bounded timeout when MyAgent does not reply", async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn(
      async (input: string | URL | Request): Promise<Response> => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/messages") return jsonResponse({ id: "ask-timeout" });
        return jsonResponse({ items: [] });
      },
    );

    try {
      const evidence = requestMyAgentEvidence({
        accessToken: "user-webex-token",
        context, question,
        capabilities: ["salesforce"],
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      await jest.advanceTimersByTimeAsync(5_000);

      await expect(evidence).resolves.toEqual({
        capabilities: ["salesforce"],
        status: "timed_out",
        detail: "MyAgent did not return a correlated reply before the ingest timeout.",
      });
      expect(fetchMock.mock.calls.filter(([input]) => requestUrl(input).pathname === "/v1/messages/direct").length).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("bounds MyAgent polling configuration to a safe range", () => {
    expect(
      getMyAgentWebexConfig({
        TOME_MYAGENT_ENABLED: "1",
        TOME_MYAGENT_WEBEX_EMAIL: " MYAGENT@EXAMPLE.COM ",
        TOME_MYAGENT_POLL_INTERVAL_MS: "1",
        TOME_MYAGENT_REPLY_TIMEOUT_MS: "999999",
      }),
    ).toEqual({
      enabled: true,
      assistantEmail: "myagent@example.com",
      pollIntervalMs: 500,
      replyTimeoutMs: 60_000,
    });
  });

  it.each([
    { context, question: " " },
    { context: { projectTitle: " " }, question },
  ])("does not send an unscoped generic request", async (scope) => {
    const fetchMock = jest.fn();
    await expect(requestMyAgentEvidence({
      accessToken: "user-webex-token", capabilities: ["outlook"],
      ...scope, fetchImpl: fetchMock,
    })).resolves.toMatchObject({ status: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
