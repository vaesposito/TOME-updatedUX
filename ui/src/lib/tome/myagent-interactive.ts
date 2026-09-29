/**
 * The extra browser-intent signal for a MyAgent delegation is deliberately
 * separate from authentication. A session cookie proves who is calling; it
 * does not prove that this particular ingest was launched from TOME's UI.
 *
 * This matters because the MCP transport can authenticate with that same
 * cookie and forwards it to the ordinary reingest route. Only the first-party
 * UI sets the intent header, and the MCP forwarder stamps its own hop so it
 * cannot be confused with a browser action.
 */
import { myAgentConsentSubjectFromSession } from "@/lib/projects/myagent-source";

/** Explicit, first-party browser intent for any MyAgent OBO action. */
export const MYAGENT_BROWSER_ACTION_HEADER = "x-tome-myagent-browser-action";
/** @deprecated Alias retained while callers migrate to the action-neutral name. */
export const MYAGENT_BROWSER_INGEST_HEADER = MYAGENT_BROWSER_ACTION_HEADER;
export const TOME_MCP_FORWARDED_HEADER = "x-tome-mcp-forwarded";

function canonicalOrigin(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

function firstPartyOrigins(): Set<string> {
  const origins = new Set<string>();
  // Never derive a trusted origin from request.url / Host. An API caller can
  // often control those values at an ingress boundary; this allowlist must be
  // deployment configuration only. With neither setting present, delegation
  // fails closed rather than treating an arbitrary Host as the TOME UI.
  for (const value of [process.env.TOME_PUBLIC_ORIGIN, process.env.NEXTAUTH_URL]) {
    const origin = canonicalOrigin(value);
    if (origin) origins.add(origin);
  }
  return origins;
}

/**
 * True only for an explicit first-party UI action that is allowed to establish
 * or use a MyAgent OBO consent. Do not loosen this to a session-only check: a
 * session cookie is also accepted by the MCP transport.
 */
export function isMyAgentInteractiveBrowserAction(
  request: Request,
  session: unknown,
): boolean {
  if (!myAgentConsentSubjectFromSession(session)) return false;
  if (request.headers.get(TOME_MCP_FORWARDED_HEADER) === "1") return false;
  if (request.headers.get(MYAGENT_BROWSER_ACTION_HEADER) !== "1") return false;

  const origin = canonicalOrigin(request.headers.get("origin"));
  return Boolean(origin && firstPartyOrigins().has(origin));
}

/** Backwards-compatible name for the reingest-specific caller. */
export function isMyAgentInteractiveBrowserIngest(
  request: Request,
  session: unknown,
): boolean {
  return isMyAgentInteractiveBrowserAction(request, session);
}
