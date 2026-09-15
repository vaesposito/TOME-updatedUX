/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/lib/tome/guard", () => ({
  isTomeServerEnabled: () => true,
}));

import { GET } from "../route";

describe("TOME REST connector OpenAPI document", () => {
  it("describes individual REST operations and API-key security", async () => {
    const response = GET(
      new NextRequest("https://example.test/api/tome/connector/openapi.json"),
    );
    const document = await response.json();

    expect(response.status).toBe(200);
    expect(document.servers).toEqual([
      {
        url: "https://{host}/api/tome/connector",
        variables: {
          host: {
            default: "grid.outshift.io",
            enum: ["grid.outshift.io", "grid.preview.outshift.io"],
            description: "TOME deployment host.",
          },
        },
      },
    ]);
    expect(Object.keys(document.paths)).toHaveLength(27);
    expect(document.paths["/tome_list_projects"].post.operationId).toBe(
      "tome_list_projects",
    );
    expect(document.paths["/tome_list_projects"].post.requestBody).toEqual(
      expect.objectContaining({
        required: true,
        content: { "application/json": { schema: expect.any(Object) } },
      }),
    );
    expect(document.paths["/tome_edit_page"]).toBeUndefined();
    expect(document.paths["/tome_create_project"]).toBeUndefined();
    for (const writeOperation of [
      "tome_edit_page",
      "tome_decision_create",
      "tome_decision_set_status",
      "tome_revert_page",
      "tome_ask",
      "tome_reingest",
      "tome_approve_ingest_draft",
      "tome_reject_ingest_draft",
      "tome_create_project",
      "tome_add_repo",
      "tome_add_webex_room",
      "tome_add_confluence_space",
      "tome_feed_send",
      "tome_promote_to_feed",
      "tome_create_gist",
      "tome_update_gist",
    ]) {
      expect(document.paths[`/${writeOperation}`]).toBeUndefined();
    }
    expect(document.paths["/version"].get.operationId).toBe("getTomeVersion");
    expect(document.paths["/version"].get.security).toEqual([{ TomeApiKey: [] }]);
    expect(document.paths["/tome_list_projects"].post.security).toEqual([
      { TomeApiKey: [] },
    ]);
    expect(document.components.securitySchemes.BearerAuth).toBeUndefined();
    expect(document.components.securitySchemes.TomeApiKey).toEqual(
      expect.objectContaining({
        type: "apiKey",
        in: "header",
        name: "x-caipe-token",
      }),
    );
  });
});
