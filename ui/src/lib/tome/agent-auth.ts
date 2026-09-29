/**
 * Server-to-agent authorization headers.
 *
 * Tome's UI and agent share `TOME_AGENT_TOKEN` / `TTT_AGENT_TOKEN` in both
 * directions: the agent uses it for callback routes and the UI uses it before
 * invoking an agent operation. Leave the header absent when configuration is
 * missing so the agent can fail closed without placing an empty credential on
 * the wire.
 */
export function tomeAgentAuthorizationHeaders(): Record<string, string> {
  const token = process.env.TOME_AGENT_TOKEN?.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
