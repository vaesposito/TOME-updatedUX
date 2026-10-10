// Internal agent callback: POST one recorded source-system fetch (success or
// error) to this run's fetch ledger. Matches
// agent/http_client.py append_fetch_ledger_entry and
// connectors/base.py record_fetch. Best-effort on the agent side — see
// docs/docs/specs/2026-09-28-tome-source-fetch-ledger/contracts/
// internal-fetch-ledger-callback.md.

import { NextRequest } from "next/server";

import { ApiError } from "@/lib/api-error";
import { withErrorHandler } from "@/lib/api-middleware";
import { insertFetchLedgerEntry } from "@/lib/tome/fetch-ledger-store";
import { requireAgentToken, resolveProject } from "@/lib/tome/internal-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; runId: string }> };

/** Identifier-shaped args each connector allows verbatim — mirrors
 * connectors/base.py's per-connector allowlists. Defense in depth: this
 * route does not trust the agent's own redaction, it re-checks it. */
const ALLOWED_ARGS: Record<string, ReadonlySet<string>> = {
  github: new Set(["repo", "since", "state", "number", "path", "ref", "offset", "limit", "project_number"]),
  confluence: new Set(["space_key", "page_id", "offset", "content_revision", "limit"]),
  webex: new Set([
    "roomId", "messageId", "personId", "meetingId", "hostEmail",
    "meetingType", "state", "from", "to", "max", "meetingNumber",
  ]),
};

const REDACTED_PATTERN = /^\[redacted:\d+-char value\]$/;

function assertArgsRedacted(connector: string, toolArgs: Record<string, unknown>): void {
  const allowed = ALLOWED_ARGS[connector];
  for (const [key, value] of Object.entries(toolArgs)) {
    if (allowed?.has(key)) continue;
    if (typeof value === "string" && REDACTED_PATTERN.test(value)) continue;
    throw new ApiError(
      `tool_args.${key} is not on ${connector}'s allowlist and is not redacted`,
      400,
      "FETCH_LEDGER_ARG_NOT_REDACTED",
    );
  }
}

interface FetchLedgerEntryBody {
  connector?: unknown;
  tool_name?: unknown;
  tool_args?: unknown;
  canonical_uri?: unknown;
  status?: unknown;
  content?: unknown;
  content_hash?: unknown;
  error_message?: unknown;
  timestamp?: unknown;
}

function validateBody(body: FetchLedgerEntryBody): {
  connector: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  canonical_uri: string;
  status: "success" | "error";
  content: string | null;
  content_hash: string | null;
  error_message: string | null;
  timestamp?: string;
} {
  if (typeof body.connector !== "string" || !body.connector) {
    throw new ApiError("connector is required", 400, "FETCH_LEDGER_INVALID_BODY");
  }
  if (typeof body.tool_name !== "string" || !body.tool_name) {
    throw new ApiError("tool_name is required", 400, "FETCH_LEDGER_INVALID_BODY");
  }
  if (typeof body.canonical_uri !== "string" || !body.canonical_uri) {
    throw new ApiError("canonical_uri is required", 400, "FETCH_LEDGER_INVALID_BODY");
  }
  if (body.status !== "success" && body.status !== "error") {
    throw new ApiError("status must be 'success' or 'error'", 400, "FETCH_LEDGER_INVALID_BODY");
  }
  const toolArgs =
    body.tool_args && typeof body.tool_args === "object" && !Array.isArray(body.tool_args)
      ? (body.tool_args as Record<string, unknown>)
      : {};
  const content = typeof body.content === "string" ? body.content : null;
  const contentHash = typeof body.content_hash === "string" ? body.content_hash : null;
  if (body.status === "success" && (!content || !contentHash)) {
    throw new ApiError(
      "a successful entry requires content and content_hash",
      400,
      "FETCH_LEDGER_INVALID_BODY",
    );
  }
  if (body.status === "error" && (content !== null || contentHash !== null)) {
    throw new ApiError(
      "a failed entry must not carry content or content_hash",
      400,
      "FETCH_LEDGER_INVALID_BODY",
    );
  }
  return {
    connector: body.connector,
    tool_name: body.tool_name,
    tool_args: toolArgs,
    canonical_uri: body.canonical_uri,
    status: body.status,
    content,
    content_hash: contentHash,
    error_message: typeof body.error_message === "string" ? body.error_message : null,
    timestamp: typeof body.timestamp === "string" ? body.timestamp : undefined,
  };
}

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  requireAgentToken(request);
  const { id, runId } = await ctx.params;
  const project = await resolveProject(id);
  const raw = (await request.json().catch(() => ({}))) as FetchLedgerEntryBody;
  const parsed = validateBody(raw);
  assertArgsRedacted(parsed.connector, parsed.tool_args);

  await insertFetchLedgerEntry({
    run_id: runId,
    project_id: project._id,
    ...parsed,
  });
  return new Response(null, { status: 204 });
});
