/** @jest-environment node */

import { tomeAgentAuthorizationHeaders } from "../agent-auth";

const originalToken = process.env.TOME_AGENT_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.TOME_AGENT_TOKEN;
  else process.env.TOME_AGENT_TOKEN = originalToken;
});

describe("Tome agent authorization headers", () => {
  it("sends the configured token as a bearer authorization header", () => {
    process.env.TOME_AGENT_TOKEN = " shared-token ";

    expect(tomeAgentAuthorizationHeaders()).toEqual({
      Authorization: "Bearer shared-token",
    });
  });

  it.each([undefined, "", "   "])("does not send a blank token (%p)", (token) => {
    if (token === undefined) delete process.env.TOME_AGENT_TOKEN;
    else process.env.TOME_AGENT_TOKEN = token;

    expect(tomeAgentAuthorizationHeaders()).toEqual({});
  });
});
