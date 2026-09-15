import { NextRequest, NextResponse } from "next/server";

import { getTomeRestReadOnlyTools } from "@/app/api/tome/mcp/route";
import { isTomeServerEnabled } from "@/lib/tome/guard";

export const dynamic = "force-dynamic";

export function GET(_request: NextRequest): NextResponse {
  if (!isTomeServerEnabled()) return new NextResponse("Not found", { status: 404 });

  const connectorServer = {
    url: "https://{host}/api/tome/connector",
    variables: {
      host: {
        default: "grid.outshift.io",
        enum: ["grid.outshift.io", "grid.preview.outshift.io"],
        description: "TOME deployment host.",
      },
    },
  };

  const paths: Record<string, unknown> = {
    "/version": {
      get: {
        operationId: "getTomeVersion",
        summary: "Get the TOME connector version",
        description: "Returns a small non-sensitive response for connectivity checks.",
        security: [{ TomeApiKey: [] }],
        responses: {
          "200": {
            description: "TOME connector version",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["service", "version", "status"],
                  properties: {
                    service: { type: "string", example: "tome" },
                    version: { type: "string", example: "0.1.0" },
                    status: { type: "string", example: "ok" },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          "401": { description: "Authentication required or invalid" },
          "403": { description: "The authenticated user lacks TOME access" },
        },
      },
    },
  };

  for (const tool of getTomeRestReadOnlyTools()) {
    paths[`/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: `Invoke ${tool.name}`,
        description: tool.description,
        security: [{ TomeApiKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: tool.inputSchema,
            },
          },
        },
        responses: {
          "200": {
            description: "TOME operation result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: { data: {} },
                  additionalProperties: false,
                },
              },
            },
          },
          "400": { description: "Invalid JSON or missing required arguments" },
          "401": { description: "Authentication required or invalid" },
          "403": { description: "The authenticated user lacks TOME access" },
          "422": { description: "TOME operation failed" },
          "502": { description: "Upstream TOME operation failed" },
        },
      },
    };
  }

  return NextResponse.json(
    {
      openapi: "3.0.3",
      info: {
        title: "TOME REST Connector API",
        version: "0.1.0",
        description:
          "Authenticated read-only REST facade for TOME project, wiki, feed, ingest status, and gist operations.",
        license: {
          name: "Apache-2.0",
          url: "https://www.apache.org/licenses/LICENSE-2.0.html",
        },
      },
      servers: [connectorServer],
      paths,
      components: {
        securitySchemes: {
          TomeApiKey: {
            type: "apiKey",
            in: "header",
            name: "x-caipe-token",
            description:
              "User-minted TOME-only API token. Clients may send the raw token or prefix it with Bearer.",
          },
        },
      },
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
