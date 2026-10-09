/** High-level MCP delegation into the same native retrieval service as GRID chat. */
import type { NextRequest } from "next/server";

import { ApiError } from "@/lib/api-middleware";
import { getMcpAuthFromBearerOrSession } from "@/lib/auth/mcp-auth";
import { trustedInteractionFromRequest } from "@/lib/authz/trusted-interaction";
import { requireAgentUsePermission } from "@/lib/rbac/openfga-agent-authz";
import { getTomeNativeChatAgentId } from "./chat-routing";
import { startTomeGlobalTurn } from "./global-chat-service";
import { isTomeServerEnabled } from "./guard";
import { requireInteractiveTomePrincipal } from "./principal";
import type { TomeRetrievalRestriction } from "./retrieval-scope";

interface PublishedSource {
  project_slug: string;
  path: string;
  title: string;
  citation: string;
  url: string;
  revision_id: string | null;
  source_revision_at: string | null;
  captured_at: string;
  content_hash: string;
  upstream_verified_at: null;
  cited_in_answer: boolean;
}

export interface TomeAgentSearchResult {
  answer: string;
  completion_status: "complete";
  session_id: string;
  scope: TomeRetrievalRestriction | null;
  citations: PublishedSource[];
  sources_consulted: PublishedSource[];
  entities_consulted: string[];
  missing_evidence: string[];
  warnings: string[];
  context_coverage: Record<string, unknown>;
  live_verification: Record<string, unknown>;
}

const STRING = { type: "string" };
const NULLABLE_STRING = { anyOf: [STRING, { type: "null" }] };
const SOURCE_SCHEMA = {
  type: "object",
  properties: {
    project_slug: STRING, path: STRING, title: STRING, citation: STRING, url: STRING,
    revision_id: NULLABLE_STRING, source_revision_at: NULLABLE_STRING, captured_at: STRING,
    content_hash: STRING, upstream_verified_at: { type: "null" }, cited_in_answer: { type: "boolean" },
  },
  required: ["project_slug", "path", "title", "citation", "url", "revision_id", "source_revision_at", "captured_at", "content_hash", "upstream_verified_at", "cited_in_answer"],
  additionalProperties: false,
};

export const TOME_AGENT_SEARCH_SCOPE_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["bhag", "area", "project"] },
    slug: { type: "string", minLength: 1, maxLength: 256 },
  },
  required: ["type", "slug"], additionalProperties: false,
};

export const TOME_AGENT_SEARCH_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    answer: STRING, completion_status: { type: "string", enum: ["complete"] }, session_id: STRING,
    scope: { anyOf: [TOME_AGENT_SEARCH_SCOPE_SCHEMA, { type: "null" }] },
    citations: { type: "array", items: SOURCE_SCHEMA }, sources_consulted: { type: "array", items: SOURCE_SCHEMA },
    entities_consulted: { type: "array", items: STRING }, missing_evidence: { type: "array", items: STRING },
    warnings: { type: "array", items: STRING }, context_coverage: { type: "object" },
    live_verification: { type: "object" },
  },
  required: ["answer", "completion_status", "session_id", "scope", "citations", "sources_consulted", "entities_consulted", "missing_evidence", "warnings", "context_coverage", "live_verification"],
  additionalProperties: false,
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid TOME structured result");
  return value as Record<string, unknown>;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20_000 || value.some((entry) => typeof entry !== "string")) {
    throw new Error("Invalid TOME evidence metadata");
  }
  return value as string[];
}

function sources(value: unknown, origin: string): PublishedSource[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error("Invalid TOME sources");
  return value.map((entry: unknown) => {
    const source = record(entry);
    for (const key of ["project_slug", "path", "title", "citation", "captured_at", "content_hash"]) {
      if (typeof source[key] !== "string") throw new Error("Invalid TOME source metadata");
    }
    const slug = source.project_slug as string;
    const path = source.path as string;
    // Match the native export's RFC 3986 path encoding, including punctuation.
    const segment = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    const citation = `/projects/${segment(slug)}/tome/wiki/${path.split("/").map(segment).join("/")}`;
    if (source.citation !== citation) throw new Error("Invalid TOME citation path");
    const nullable = (value: unknown): string | null => {
      if (value === null) return null;
      if (typeof value === "string") return value;
      throw new Error("Invalid TOME revision metadata");
    };
    return {
      project_slug: slug, path, title: source.title as string, citation, url: `${origin}${citation}`,
      revision_id: nullable(source.revision_id), source_revision_at: nullable(source.source_revision_at),
      captured_at: source.captured_at as string, content_hash: source.content_hash as string,
      // This runtime verifies published wiki access, not live upstream facts.
      upstream_verified_at: null, cited_in_answer: source.cited_in_answer === true,
    };
  });
}

export async function tomeAgentSearch(
  request: NextRequest,
  args: Record<string, unknown>,
  origin: string,
): Promise<TomeAgentSearchResult> {
  if (!isTomeServerEnabled()) throw new ApiError("Not found", 404, "NOT_FOUND");
  if (Object.keys(args).some((key) => !["query", "scope", "session_id", "verify_sources"].includes(key)) ||
      args.verify_sources !== undefined && typeof args.verify_sources !== "boolean" ||
      typeof args.query !== "string" || !args.query.trim() || args.query.length > 12_000) {
    throw new ApiError("query is required and must be at most 12000 characters", 400, "INVALID_SEARCH_ARGUMENTS");
  }
  let scope: TomeRetrievalRestriction | undefined;
  if (args.scope !== undefined) {
    const value = record(args.scope);
    if (Object.keys(value).some((key) => key !== "type" && key !== "slug") ||
        !["bhag", "area", "project"].includes(String(value.type)) ||
        typeof value.slug !== "string" || !value.slug.trim() || value.slug.length > 256) {
      throw new ApiError("scope requires an entity type and slug", 400, "INVALID_SEARCH_SCOPE");
    }
    scope = { type: value.type as TomeRetrievalRestriction["type"], slug: value.slug.trim() };
  }
  if (args.session_id !== undefined && (typeof args.session_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.session_id))) {
    throw new ApiError("session_id must be an opaque ID returned by this tool", 400, "INVALID_SEARCH_SESSION");
  }
  const { user, session } = await getMcpAuthFromBearerOrSession(request);
  requireInteractiveTomePrincipal(session);
  if (!session.sub || !["oidc_user", "tome_api_key"].includes(session.principalType ?? "") ||
      ("isServiceAccount" in session && session.isServiceAccount)) {
    throw new ApiError("A user JWT, linked user session or user-owned TOME API key is required", 403, "TOME_USER_REQUIRED");
  }
  const agentId = getTomeNativeChatAgentId();
  if (!agentId) throw new ApiError("TOME chat agent is not configured", 503, "AGENT_NOT_CONFIGURED");
  const denied = await requireAgentUsePermission({
    subject: session.sub, agentId, email: user.email, isServiceAccount: false,
    trustedContext: { interaction: trustedInteractionFromRequest(request) },
  });
  if (denied) throw new ApiError("TOME agent use permission is required", denied.status, "TOME_AGENT_USE_REQUIRED");
  const turn = await startTomeGlobalTurn({
    subject: session.sub, email: user.email, message: args.query,
    session: { kind: "mcp", id: args.session_id as string | undefined }, scope, signal: request.signal,
    verifySources: args.verify_sources as boolean | undefined,
  });
  let answer = "";
  let completed: Record<string, unknown> | null = null;
  for await (const frame of turn.events) {
    const data = record(JSON.parse(frame.data));
    if (frame.event === "token" && typeof data.text === "string") {
      answer += data.text;
      if (answer.length > 128_000) throw new Error("TOME answer exceeds its limit; narrow the query");
    }
    if (frame.event === "error") throw new Error(typeof data.message === "string" ? data.message : "TOME retrieval failed");
    if (frame.event === "done" && data.success === true) completed = data;
  }
  if (!completed || !answer.trim()) throw new Error("TOME search ended before completion");
  if (!Array.isArray(completed.citations) || !Array.isArray(completed.sources_consulted)) {
    throw new Error("TOME agent lacks structured retrieval results; deploy the matching native agent version");
  }
  return {
    answer: answer.trim(), completion_status: "complete", session_id: turn.sessionId, scope: scope ?? null,
    citations: sources(completed.citations, origin), sources_consulted: sources(completed.sources_consulted, origin),
    entities_consulted: strings(completed.entities_consulted), missing_evidence: strings(completed.missing_evidence),
    warnings: strings(completed.warnings), context_coverage: record(completed.context_coverage),
    live_verification: record(completed.live_verification ?? { mode: "off", status: "not_requested", live_sources: [], claim_checks: [], warnings: [] }),
  };
}
