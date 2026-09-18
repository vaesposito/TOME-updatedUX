/**
 * Server-only MyAgent Webex bridge.
 *
 * Outlook, Salesforce, and SharePoint credentials never enter CAIPE. A Tome
 * ingest uses the triggering user's dedicated MyAgent Webex OAuth connection to send
 * one DM which names the user's requested categories to the
 * deployment-configured MyAgent identity, then passes only the correlated
 * reply to the ingest agent as untrusted evidence. The category list limits
 * TOME's request, not MyAgent's credentials: only a MyAgent-owned scoped API
 * or policy can enforce connector use or attest reply provenance.
 *
 * This deliberately does not reuse managed-webex.ts: a deployment-owned
 * Webex account is not permitted to act as an opted-in user.
 */

import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import type { ProviderConnectionMetadata } from "@/lib/credentials/oauth-service";
import {
  myAgentConnectorLabel,
  normalizeMyAgentConnectors,
  type MyAgentConnector,
} from "@/lib/projects/myagent-source";

const WEBEX_API = "https://webexapis.com/v1";
const REQUIRED_SCOPES = ["spark:kms", "spark:messages_read", "spark:messages_write"] as const;
const MAX_EVIDENCE_CHARS = 8_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_REPLY_TIMEOUT_MS = 30_000;

export interface MyAgentWebexConfig {
  enabled: boolean;
  assistantEmail: string;
  pollIntervalMs: number;
  replyTimeoutMs: number;
}

export interface MyAgentWebexCredential {
  available: boolean;
  /** Server-only; callers must never serialize this into a browser/API payload. */
  accessToken?: string;
  connection?: ProviderConnectionMetadata;
  reason?: string;
  /** Whether the signed-in person can plausibly resolve this in Connections. */
  fixableByUser?: boolean;
}

export interface MyAgentEvidence {
  /** Categories requested from MyAgent; not verified reply provenance. */
  capabilities: MyAgentConnector[];
  status: "received" | "unavailable" | "timed_out";
  /** Bounded external evidence only; never a Webex bearer token. */
  content?: string;
  detail?: string;
}

export interface MyAgentResearchContext {
  projectTitle: string;
  projectDescription?: string;
}

interface WebexMessage {
  id?: string;
  roomId?: string;
  personEmail?: string;
  created?: string;
  parentId?: string;
  markdown?: string;
  text?: string;
}

function enabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

function boundedMs(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

export function getMyAgentWebexConfig(
  env: NodeJS.ProcessEnv = process.env,
): MyAgentWebexConfig {
  return {
    enabled: enabled(env.TOME_MYAGENT_ENABLED),
    assistantEmail: clean(env.TOME_MYAGENT_WEBEX_EMAIL).toLowerCase(),
    pollIntervalMs: boundedMs(
      env.TOME_MYAGENT_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
      500,
      10_000,
    ),
    replyTimeoutMs: boundedMs(
      env.TOME_MYAGENT_REPLY_TIMEOUT_MS,
      DEFAULT_REPLY_TIMEOUT_MS,
      5_000,
      60_000,
    ),
  };
}

function missingRequiredScopes(connection: ProviderConnectionMetadata): string[] {
  // Legacy connections did not persist granted scopes. Treat those as unknown
  // (rather than incorrectly declaring a valid token unusable); the actual
  // request still fails closed on a Webex 403.
  if (!connection.grantedScopes?.length) return [];
  return REQUIRED_SCOPES.filter((scope) => !connection.grantedScopes!.includes(scope));
}

/**
 * Resolve only the requested user's dedicated webex_myagent connection. This avoids
 * resolveProjectCredentials(), which can intentionally substitute a managed
 * Webex account for room ingestion.
 */
export async function resolveMyAgentWebexCredential(
  sub: string,
): Promise<MyAgentWebexCredential> {
  const config = getMyAgentWebexConfig();
  if (!config.enabled) {
    return {
      available: false,
      reason: "MyAgent ingestion is disabled for this deployment.",
      fixableByUser: false,
    };
  }
  if (!config.assistantEmail) {
    return {
      available: false,
      reason: "MyAgent Webex recipient is not configured for this deployment.",
      fixableByUser: false,
    };
  }
  if (!sub.trim()) {
    return {
      available: false,
      reason: "A user Webex identity is required for MyAgent ingestion.",
      fixableByUser: false,
    };
  }

  try {
    const service = await getProviderConnectionService();
    const connections = await service.listConnections({ type: "user", id: sub });
    const connection = connections.find(
      (candidate) => candidate.provider === "webex_myagent" && candidate.status === "connected",
    );
    if (!connection) {
      return {
        available: false,
        reason: "Connect MyAgent (Webex) in Connections before using MyAgent ingestion. A general Webex connection is separate.",
        fixableByUser: true,
      };
    }
    const missing = missingRequiredScopes(connection);
    if (missing.length > 0) {
      return {
        available: false,
        connection,
        reason: "Reconnect MyAgent (Webex) and grant encryption, message read, and message send permissions.",
        fixableByUser: true,
      };
    }
    const refreshed = await service.refreshConnection(connection.id);
    if (!refreshed.accessToken) {
      return {
        available: false,
        connection,
        reason: "Reconnect MyAgent (Webex) in Connections before using MyAgent ingestion.",
        fixableByUser: true,
      };
    }
    return { available: true, accessToken: refreshed.accessToken, connection };
  } catch {
    return {
      available: false,
      reason: "Reconnect MyAgent (Webex) in Connections before using MyAgent ingestion.",
      fixableByUser: true,
    };
  }
}

function safeText(value: string | undefined, maxChars: number): string {
  return (value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, maxChars);
}

/** Never let a stalled Webex request outlive the bounded ingestion operation. */
async function fetchWithin(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function askMarkdown(input: {
  capabilities: MyAgentConnector[];
  context: MyAgentResearchContext;
  question: string;
}): string {
  const title = safeText(input.context.projectTitle, 200).replace(/\s+/g, " ");
  const description = safeText(input.context.projectDescription, 1_000).replace(/\s+/g, " ");
  const sources = input.capabilities.map(myAgentConnectorLabel).join(", ");
  return [
    safeText(input.question, 2_000),
    `This is about the project "${title}". Please look in ${sources}.`,
    description ? `Project context: ${description}` : "",
    "Answer the question with relevant findings, dates and source links—not just message subjects or file names. Skip unrelated inbox items, employee profiles and general documentation. If you find nothing relevant, say so.",
    "Keep it concise (at most 8,000 characters). Read-only research; reply in this thread.",
  ]
    .filter(Boolean)
    .join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function replyText(message: WebexMessage): string {
  return safeText(message.markdown || message.text, MAX_EVIDENCE_CHARS);
}

function isAcknowledgementOnly(value: string): boolean {
  return /^(?:ack(?:nowledged)?|got it|working on it|one moment|please wait)[.!…\s]*$/i.test(
    value,
  );
}

/** True only when the candidate's parent chain reaches this exact outbound ask. */
function isReplyToAsk(
  candidate: WebexMessage,
  askId: string,
  messagesById: Map<string, WebexMessage>,
): boolean {
  let parentId = candidate.parentId;
  const seen = new Set<string>();
  for (let depth = 0; parentId && depth < 16; depth += 1) {
    if (parentId === askId) return true;
    if (seen.has(parentId)) return false;
    seen.add(parentId);
    parentId = messagesById.get(parentId)?.parentId;
  }
  return false;
}

async function listDirectMessages(input: {
  accessToken: string;
  assistantEmail: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<WebexMessage[]> {
  const url = new URL(`${WEBEX_API}/messages/direct`);
  url.searchParams.set("personEmail", input.assistantEmail);
  url.searchParams.set("max", "100");
  const response = await fetchWithin(
    input.fetchImpl,
    url.href,
    {
      headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" },
      cache: "no-store",
    },
    input.timeoutMs,
  );
  if (!response.ok) {
    throw new Error(`Webex reply lookup failed (${response.status})`);
  }
  const body = (await response.json().catch(() => ({}))) as { items?: WebexMessage[] };
  return Array.isArray(body.items) ? body.items : [];
}

/**
 * Send a bounded, correlated DM and return its result as evidence. A timeout
 * is explicit: the ingest continues without inventing a MyAgent result, while
 * its run log and agent prompt retain the unavailable status.
 */
export async function requestMyAgentEvidence(input: {
  accessToken: string;
  capabilities: MyAgentConnector[];
  context: MyAgentResearchContext;
  question: string;
  fetchImpl?: typeof fetch;
}): Promise<MyAgentEvidence> {
  const capabilities = normalizeMyAgentConnectors(input.capabilities);
  if (capabilities.length === 0) {
    return { capabilities, status: "unavailable", detail: "No MyAgent request categories were selected." };
  }
  if (!safeText(input.context.projectTitle, 200)) {
    return { capabilities, status: "unavailable", detail: "A project title is required to scope the MyAgent request." };
  }
  if (!safeText(input.question, 2_000)) {
    return { capabilities, status: "unavailable", detail: "A specific question is required for MyAgent." };
  }
  const config = getMyAgentWebexConfig();
  if (!config.enabled || !config.assistantEmail) {
    return {
      capabilities,
      status: "unavailable",
      detail: "MyAgent ingestion is not configured for this deployment.",
    };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const deadline = Date.now() + config.replyTimeoutMs;
  let sent: WebexMessage;
  try {
    const response = await fetchWithin(
      fetchImpl,
      `${WEBEX_API}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          toPersonEmail: config.assistantEmail,
          markdown: askMarkdown({
            capabilities,
            context: input.context,
            question: input.question,
          }),
        }),
      },
      config.replyTimeoutMs,
    );
    if (!response.ok) {
      return {
        capabilities,
        status: "unavailable",
        detail:
          response.status === 401 || response.status === 403
            ? "Webex rejected the delegated request. Reconnect Webex and grant message permissions."
            : `Webex could not send the MyAgent request (HTTP ${response.status}).`,
      };
    }
    sent = (await response.json().catch(() => ({}))) as WebexMessage;
  } catch {
    return {
      capabilities,
      status: "unavailable",
      detail: "Webex could not send the MyAgent request.",
    };
  }

  const askId = sent.id?.trim();
  if (!askId) {
    return {
      capabilities,
      status: "unavailable",
      detail: "Webex did not return an identifier for the MyAgent request.",
    };
  }
  while (Date.now() <= deadline) {
    try {
      const messages = await listDirectMessages({
        accessToken: input.accessToken,
        assistantEmail: config.assistantEmail,
        fetchImpl,
        timeoutMs: Math.max(1, deadline - Date.now()),
      });
      const messagesById = new Map<string, WebexMessage>();
      for (const message of messages) {
        if (message.id) messagesById.set(message.id, message);
      }
      const reply = messages.find((message) => {
        const sender = message.personEmail?.trim().toLowerCase();
        const text = replyText(message);
        return (
          sender === config.assistantEmail &&
          Boolean(text) &&
          !isAcknowledgementOnly(text) &&
          isReplyToAsk(message, askId, messagesById)
        );
      });
      if (reply) {
        return {
          capabilities,
          status: "received",
          content: replyText(reply),
        };
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Webex reply lookup failed.";
      return { capabilities, status: "unavailable", detail };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(config.pollIntervalMs, remaining));
  }
  return {
    capabilities,
    status: "timed_out",
    detail: "MyAgent did not return a correlated reply before the ingest timeout.",
  };
}
