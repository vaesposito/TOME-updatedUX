/**
 * The MyAgent integrations a project may explicitly delegate to during Tome
 * ingestion. These are deliberately a small, static allow-list: CAIPE does
 * not hold the credentials for Outlook, Salesforce, or SharePoint. MyAgent
 * owns their authorization on the user's behalf.
 */

export const MYAGENT_CONNECTORS = ["outlook", "salesforce", "sharepoint"] as const;

export type MyAgentConnector = (typeof MYAGENT_CONNECTORS)[number];

export const MYAGENT_CONNECTOR_SETTINGS_URL =
  "https://circuit.cisco.com/myagent/settings/connectors";

export interface MyAgentConnectorOption {
  id: MyAgentConnector;
  label: string;
  capabilities: string;
  description: string;
}

/**
 * Server-side, per-user authorization for TOME to send MyAgent a request
 * naming these categories. This is deliberately never accepted from a client
 * request: its subject and timestamp are derived from the authenticated
 * browser session. It is not an underlying provider credential grant and
 * cannot itself verify which connector MyAgent used to compose a reply.
 */
export interface MyAgentConsent {
  subject: string;
  connectors: MyAgentConnector[];
  granted_at: string;
  /** Opaque server-issued compare-and-swap value for this subject's choice. */
  revision?: string;
  /** Present on a revoke tombstone; never projected to other users. */
  revoked_at?: string;
}

type MyAgentSourceFields = {
  myagent_consents?: unknown;
};

export const MYAGENT_CONNECTOR_OPTIONS: readonly MyAgentConnectorOption[] = [
  {
    id: "outlook",
    label: "Outlook",
    capabilities: "Email Management · Smart Folders · AI Summaries",
    description:
      "Email, calendar, folders, and mail-rule context through your MyAgent-connected Outlook account",
  },
  {
    id: "salesforce",
    label: "Salesforce",
    capabilities: "Opportunity Management",
    description:
      "CRM context for forecasts, high-priority approvals, and action items through MyAgent",
  },
  {
    id: "sharepoint",
    label: "SharePoint",
    capabilities: "Search Sites · AI Summaries",
    description:
      "Read context from SharePoint Online site pages and documents via Microsoft Graph on your behalf",
  },
];

const OPTIONS_BY_ID = new Map(MYAGENT_CONNECTOR_OPTIONS.map((option) => [option.id, option]));

export function isMyAgentConnector(value: unknown): value is MyAgentConnector {
  return typeof value === "string" && (MYAGENT_CONNECTORS as readonly string[]).includes(value);
}

/**
 * Treat stored selections as untrusted input: normalize casing, drop unknown
 * entries, and preserve the canonical display order without duplicates.
 */
export function normalizeMyAgentConnectors(value: unknown): MyAgentConnector[] {
  const selected = new Set<string>();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") selected.add(item.trim().toLowerCase());
    }
  }
  return MYAGENT_CONNECTORS.filter((connector) => selected.has(connector));
}

/**
 * Normalize stored consent records defensively and de-dupe by subject.
 *
 * The final raw record is authoritative even when it is a zero-connector
 * revoke tombstone or malformed legacy value. Deleting an earlier live grant
 * in that case is deliberately fail-closed: a later malformed/tombstone row
 * must never resurrect a previously selected connector during ingestion.
 */
export function normalizeMyAgentConsents(value: unknown): MyAgentConsent[] {
  if (!Array.isArray(value)) return [];
  const bySubject = new Map<string, MyAgentConsent>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const subject = typeof record.subject === "string" ? record.subject.trim() : "";
    const connectors = normalizeMyAgentConnectors(record.connectors);
    const grantedAt = typeof record.granted_at === "string" ? record.granted_at.trim() : "";
    if (!subject) continue;
    if (connectors.length === 0 || !grantedAt) {
      bySubject.delete(subject);
      continue;
    }
    bySubject.set(subject, { subject, connectors, granted_at: grantedAt });
  }
  return [...bySubject.values()].sort((left, right) => left.subject.localeCompare(right.subject));
}

/** Return only the integrations this exact identity has authorized. */
export function myAgentConnectorsForSubject(
  sources: MyAgentSourceFields | undefined,
  subject: string | null | undefined,
): MyAgentConnector[] {
  const normalizedSubject = subject?.trim();
  if (!normalizedSubject) return [];
  return normalizeMyAgentConsents(sources?.myagent_consents).find(
    (consent) => consent.subject === normalizedSubject,
  )?.connectors ?? [];
}

/**
 * Return the last raw record's opaque revision for one subject. A revoke is
 * retained as a zero-connector tombstone specifically so a delayed browser
 * PUT carrying the previous revision cannot re-grant after Disconnect.
 */
export function myAgentConsentRevisionForSubject(
  sources: MyAgentSourceFields | undefined,
  subject: string | null | undefined,
): string | null {
  const normalizedSubject = subject?.trim();
  if (!normalizedSubject || !Array.isArray(sources?.myagent_consents)) return null;
  let revision: string | null = null;
  for (const item of sources.myagent_consents) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const recordSubject = typeof record.subject === "string" ? record.subject.trim() : "";
    if (recordSubject !== normalizedSubject) continue;
    revision = typeof record.revision === "string" && record.revision.trim()
      ? record.revision.trim()
      : null;
  }
  return revision;
}

export function hasMyAgentConsent(
  sources: MyAgentSourceFields | undefined,
): boolean {
  return normalizeMyAgentConsents(sources?.myagent_consents).length > 0;
}

/**
 * A delegated reply belongs to the user who authorized the run. TOME admins
 * are the operational exception so they can investigate protected runs.
 */
export function mayViewMyAgentRunEvidence(
  runOwnerSubject: string | null | undefined,
  viewerSubject: string | null | undefined,
  isTomeAdmin: boolean,
): boolean {
  if (isTomeAdmin) return true;
  const owner = runOwnerSubject?.trim();
  const viewer = viewerSubject?.trim();
  return Boolean(owner && viewer && owner === viewer);
}

/**
 * Consent may be created only from the first-party browser session. A Bearer
 * request can represent an OBO exchange, bot, MCP client, or service account;
 * none may make an on-behalf-of Webex authorization decision for a human.
 */
export function myAgentConsentSubjectFromSession(session: unknown): string | null {
  const candidate = (session ?? {}) as {
    authMethod?: unknown;
    principalType?: unknown;
    sub?: unknown;
  };
  const subject = typeof candidate.sub === "string" ? candidate.sub.trim() : "";
  const firstPartyUser =
    candidate.authMethod === "session" &&
    (candidate.principalType === undefined || candidate.principalType === "oidc_user");
  return firstPartyUser && subject ? subject : null;
}

/**
 * Remove private per-user consent records before returning sources to a
 * browser or MCP client. The two legacy UI fields are a view of the caller's
 * own consent only, never a project-wide authorization flag.
 */
export function myAgentSourcesForSubject<T extends MyAgentSourceFields>(
  sources: T | undefined,
  subject: string | null | undefined,
): Omit<T, "myagent_consents"> & {
  myagent_connectors: MyAgentConnector[];
  myagent_enabled: boolean;
  /** Private to the caller, used to reject stale cross-tab consent writes. */
  myagent_consent_revision: string | null;
} | undefined {
  if (!sources) return undefined;
  const { myagent_consents: _privateConsents, ...publicSources } = sources;
  const connectors = myAgentConnectorsForSubject(sources, subject);
  return {
    ...publicSources,
    myagent_connectors: connectors,
    myagent_enabled: connectors.length > 0,
    myagent_consent_revision: myAgentConsentRevisionForSubject(sources, subject),
  };
}

export function myAgentConnectorOption(
  connector: MyAgentConnector,
): MyAgentConnectorOption {
  return OPTIONS_BY_ID.get(connector)!;
}

export function myAgentConnectorLabel(connector: MyAgentConnector): string {
  return myAgentConnectorOption(connector).label;
}
