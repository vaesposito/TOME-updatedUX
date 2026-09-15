import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";

import {
  isMyAgentInteractiveBrowserIngest,
  MYAGENT_BROWSER_INGEST_HEADER,
  TOME_MCP_FORWARDED_HEADER,
} from "../myagent-interactive";

const session = {
  authMethod: "session",
  principalType: "oidc_user",
  sub: "user-a",
};

function request(headers: Record<string, string> = {}): Request {
  const values = new Map(
    Object.entries({
      origin: "https://tome.example.test",
      [MYAGENT_BROWSER_INGEST_HEADER]: "1",
      ...headers,
    }).map(([key, value]) => [key.toLowerCase(), value]),
  );
  // Jest's node environment does not install the Fetch globals. The helper
  // only needs Request.url and Headers.get, so keep this test runtime-neutral.
  return {
    url: "https://tome.example.test/api/tome/projects/demo/reingest",
    headers: { get: (name: string) => values.get(name.toLowerCase()) ?? null },
  } as Request;
}

describe("MyAgent browser ingest provenance", () => {
  const originalPublicOrigin = process.env.TOME_PUBLIC_ORIGIN;
  const originalNextAuthUrl = process.env.NEXTAUTH_URL;

  beforeEach(() => {
    process.env.TOME_PUBLIC_ORIGIN = "https://tome.example.test";
    delete process.env.NEXTAUTH_URL;
  });

  afterAll(() => {
    if (originalPublicOrigin === undefined) delete process.env.TOME_PUBLIC_ORIGIN;
    else process.env.TOME_PUBLIC_ORIGIN = originalPublicOrigin;
    if (originalNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = originalNextAuthUrl;
  });

  it("accepts the explicit same-origin action from a session-authenticated user", () => {
    expect(isMyAgentInteractiveBrowserIngest(request(), session)).toBe(true);
  });

  it("rejects an MCP forwarding hop even when it carries the user's session cookie", () => {
    expect(
      isMyAgentInteractiveBrowserIngest(
        request({ [TOME_MCP_FORWARDED_HEADER]: "1" }),
        session,
      ),
    ).toBe(false);
  });

  it("requires the UI intent header, a matching origin, and session authentication", () => {
    expect(isMyAgentInteractiveBrowserIngest(request({ [MYAGENT_BROWSER_INGEST_HEADER]: "0" }), session)).toBe(false);
    expect(isMyAgentInteractiveBrowserIngest(request({ origin: "https://other.example.test" }), session)).toBe(false);
    expect(
      isMyAgentInteractiveBrowserIngest(request(), { ...session, authMethod: "bearer" }),
    ).toBe(false);
  });

  it("does not trust a forged request URL or Host as a first-party origin", () => {
    const forged = request({ origin: "https://evil.example.test" });
    Object.defineProperty(forged, "url", {
      value: "https://evil.example.test/api/tome/projects/demo/reingest",
    });
    expect(isMyAgentInteractiveBrowserIngest(forged, session)).toBe(false);
  });

  it("fails closed when the deployment has no configured first-party origin", () => {
    delete process.env.TOME_PUBLIC_ORIGIN;
    delete process.env.NEXTAUTH_URL;
    expect(isMyAgentInteractiveBrowserIngest(request(), session)).toBe(false);
  });
});
