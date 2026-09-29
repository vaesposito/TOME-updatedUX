jest.mock("@/lib/api-middleware", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public statusCode: number = 500,
      public code?: string,
    ) {
      super(message);
    }
  },
}));

jest.mock("@/lib/mcp-credential-headers", () => ({
  resolveMcpHeaderCredentials: jest.fn(),
}));

import { invokeHttpMcpTool, listHttpMcpTools } from "@/lib/mcp-http-server-client";

function response(input: {
  status: number;
  body: unknown;
  sessionId?: string;
}): Response {
  return {
    ok: input.status >= 200 && input.status < 300,
    status: input.status,
    headers: new Headers({
      "content-type": typeof input.body === "string" ? "text/plain" : "application/json",
      ...(input.sessionId ? { "mcp-session-id": input.sessionId } : {}),
    }),
    json: async () => input.body,
    text: async () => typeof input.body === "string" ? input.body : JSON.stringify(input.body),
  } as Response;
}

describe("per-call MCP time budgets", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });

  it.each([undefined, 45000])("keeps default callers at 15s but honors an override of %s", async (timeoutMs) => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async (_url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (body.method === "initialize") return response({ status: 200, sessionId: "session", body: { result: {} } });
      if (body.method !== "tools/call") return response({ status: 204, body: "" });
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(response({ status: 200, body: { result: { items: [] } } })), 20000);
        init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); });
      });
    });
    const pending = invokeHttpMcpTool({
      request: {} as never, session: { sub: "test-user" },
      server: { _id: "test", endpoint: "http://example-mcp:8000/mcp", source: "manual", transport: "http", enabled: true } as never,
      serverId: "test", toolName: "calendar", params: {},
      credentialResolution: { headers: {}, sources: [] }, timeoutMs,
    }).catch((error: Error) => error);
    await jest.advanceTimersByTimeAsync(21000);
    const result = await pending;
    if (timeoutMs === undefined) expect(result).toMatchObject({ name: "AbortError" });
    else expect(result).toMatchObject({ ok: true, status: 200 });
  });
});

describe("listHttpMcpTools", () => {
  const originalFetch = global.fetch;
  const originalGatewayUrl = process.env.AGENT_GATEWAY_URL;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.AGENT_GATEWAY_URL = originalGatewayUrl;
    jest.restoreAllMocks();
  });

  it("retries a transient AgentGateway route-registration 404", async () => {
    process.env.AGENT_GATEWAY_URL = "http://gateway:4000";
    const gatewaySessionId = Buffer.from(JSON.stringify({
      t: "mcp",
      s: [{ t: "example", s: "upstream-session-1" }],
    })).toString("base64url");
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response({ status: 404, body: "route not found" }))
      .mockResolvedValueOnce(response({
        status: 200,
        sessionId: gatewaySessionId,
        body: { jsonrpc: "2.0", id: "initialize", result: { protocolVersion: "2024-11-05" } },
      }))
      .mockResolvedValueOnce(response({
        status: 200,
        sessionId: gatewaySessionId,
        body: {
          jsonrpc: "2.0",
          id: "tools-list",
          result: { tools: [{ name: "echo", description: "Harmless test tool" }] },
        },
      }))
      .mockResolvedValueOnce(response({ status: 200, body: "" }))
      .mockResolvedValueOnce(response({ status: 204, body: "" }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await listHttpMcpTools({
      request: {} as never,
      session: { sub: "test-user" },
      server: {
        _id: "example",
        name: "Example",
        transport: "http",
        endpoint: "http://gateway:4000/mcp/example",
        agentgateway_target_endpoint: "http://example-mcp:8000/mcp",
        enabled: true,
        source: "agentgateway",
      } as never,
      serverId: "example",
      credentialResolution: {
        headers: { Authorization: "Bearer test-token" },
        sources: [],
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[3]).toEqual([
      "http://example-mcp:8000/mcp",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ "mcp-session-id": "upstream-session-1" }),
      }),
    ]);
    expect(fetchMock.mock.calls[4][1]).toMatchObject({
      method: "DELETE",
      headers: expect.objectContaining({ "mcp-session-id": gatewaySessionId }),
    });
    expect(result.tools).toEqual([
      expect.objectContaining({ name: "echo", namespaced_name: "echo" }),
    ]);
  });

  it("does not retry an AgentGateway authorization denial", async () => {
    process.env.AGENT_GATEWAY_URL = "http://gateway:4000";
    const fetchMock = jest.fn().mockResolvedValue(
      response({ status: 403, body: "forbidden" }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(listHttpMcpTools({
      request: {} as never,
      session: { sub: "test-user" },
      server: {
        _id: "example",
        name: "Example",
        transport: "http",
        endpoint: "http://gateway:4000/mcp/example",
        enabled: true,
        source: "agentgateway",
      } as never,
      serverId: "example",
      credentialResolution: {
        headers: { Authorization: "Bearer test-token" },
        sources: [],
      },
    })).rejects.toMatchObject({
      statusCode: 502,
      code: "MCP_INIT_FAILED",
      message: "MCP initialize failed with HTTP 403",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
