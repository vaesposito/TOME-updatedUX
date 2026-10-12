/**
 * Delivering a Tome notification into Webex.
 *
 * Messages go out as the platform's bot, through the bot service's existing
 * admin endpoint, for two reasons. The bot already holds a Webex token in a
 * process the browser cannot reach, so no new credential has to be handled
 * here; and a notification should visibly come from the platform rather than
 * appear to have been typed by the reader it is addressed to.
 *
 * The consequence to design around is that the bot can only post where it
 * has been added. A space the reader can see is not necessarily one the bot
 * can reach, which is why the picker is sourced from the bot's own space
 * list rather than from the reader's.
 *
 * Server-only. Never import this from a client component: it reaches a
 * service the browser has no business talking to.
 */

import { ApiError } from "@/lib/api-error";
import { callWebexBotAdmin } from "@/lib/webex-bot-admin";
import { listWebexBotPolicies } from "@/lib/webex-bot-policy";
import type {
  WebexDeliveryCapability,
  WebexDeliverySpace,
} from "@/types/webex-delivery";

/** Webex's own ceiling on a message, which the bot endpoint also enforces. */
const MAX_MARKDOWN = 4000;

/**
 * Whether delivery is configured well enough to be worth offering.
 *
 * Config only, no network call: this answers the tab's first render, and a
 * settings page should not wait on a round trip to a service that may be
 * absent in order to tell you it is absent. A misconfiguration that only
 * shows up on the wire surfaces as a send error instead.
 */
export function webexDeliveryCapability(): WebexDeliveryCapability {
  const hasSecret = Boolean(
    process.env.WEBEX_BOT_ADMIN_CLIENT_SECRET?.trim() ||
      process.env.OIDC_CLIENT_SECRET?.trim(),
  );
  if (!hasSecret) {
    return {
      available: false,
      reason:
        "Webex delivery needs the platform's Webex bot service. Ask an administrator to configure it.",
    };
  }
  const hasIssuer = Boolean(
    process.env.OIDC_DISCOVERY_URL?.trim() ||
      process.env.OIDC_ISSUER?.trim() ||
      process.env.WEBEX_BOT_ADMIN_TOKEN_URL?.trim(),
  );
  if (!hasIssuer) {
    return {
      available: false,
      reason:
        "Webex delivery needs single sign-on to be configured so the platform can authenticate to its Webex bot.",
    };
  }
  return { available: true };
}

interface BotSpace {
  id?: string;
  name?: string;
}

/**
 * The spaces the bot can post to.
 *
 * Sourced from the bot rather than from the reader on purpose: these are the
 * only spaces a rule could actually deliver to, so offering any others would
 * be offering a choice that silently fails later.
 *
 * Spaces are fanned across every configured bot and de-duplicated, because a
 * deployment can run more than one and the reader should not have to know
 * which of them is in which space.
 */
export async function listWebexDeliverySpaces(options?: {
  query?: string;
  signal?: AbortSignal;
}): Promise<WebexDeliverySpace[]> {
  // Reaching the catalog at all is what proves the bot service is there, so
  // a failure here is reported as the dependency being down rather than
  // escalating to a 500 that reads as a bug in this app.
  let bots;
  try {
    bots = await listWebexBotPolicies();
  } catch {
    throw new ApiError(
      "The platform's Webex bot service is unreachable, so its spaces cannot be listed.",
      503,
      "WEBEX_BOT_UNAVAILABLE",
    );
  }
  const available = bots.filter((bot) => bot.available !== false);
  if (available.length === 0) return [];

  const byId = new Map<string, WebexDeliverySpace>();
  const results = await Promise.allSettled(
    available.map((bot) =>
      callWebexBotAdmin<{ spaces?: BotSpace[] }>(
        `/admin/webex/bots/${encodeURIComponent(bot.id)}/spaces`,
        {
          query: { limit: 200, ...(options?.query ? { q: options.query } : {}) },
          ...(options?.signal ? { signal: options.signal } : {}),
        },
      ),
    ),
  );
  for (const result of results) {
    // One unreachable bot must not empty the picker. A partial list is a
    // usable list; a thrown error here would read as "you are in no spaces".
    if (result.status !== "fulfilled") continue;
    for (const space of result.value.spaces ?? []) {
      if (space.id && space.name && !byId.has(space.id)) {
        byId.set(space.id, { id: space.id, name: space.name });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type WebexDeliveryAddress =
  | { kind: "space"; spaceId: string }
  | { kind: "direct"; personEmail: string };

/**
 * Post one message, returning false if it could not be delivered.
 *
 * Failure is a return value rather than a throw because every caller is a
 * fan-out: one reader's bad space id or departed account must not stop the
 * rest of a digest run. Callers that are serving a request directly and want
 * the reason should pass `throwOnError`.
 */
export async function sendWebexMessage(input: {
  to: WebexDeliveryAddress;
  markdown: string;
  throwOnError?: boolean;
  signal?: AbortSignal;
}): Promise<boolean> {
  const markdown = input.markdown.trim();
  if (!markdown) return false;
  if (markdown.length > MAX_MARKDOWN) {
    // Truncation is the caller's job: only it knows which part of the
    // message matters, and a digest silently losing its last entries is
    // worse than one that says it was shortened.
    if (input.throwOnError) {
      throw new ApiError(
        `Webex message exceeds ${MAX_MARKDOWN} characters`,
        400,
      );
    }
    return false;
  }

  try {
    await callWebexBotAdmin("/admin/webex/notifications", {
      method: "POST",
      body:
        input.to.kind === "space"
          ? { space_id: input.to.spaceId, markdown }
          : { person_email: input.to.personEmail, markdown },
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return true;
  } catch (error) {
    if (input.throwOnError) throw error;
    return false;
  }
}

/** Where a rule's messages go, or null when it cannot name a recipient. */
export function deliveryAddress(input: {
  destination: string;
  spaceId?: string;
  email?: string;
}): WebexDeliveryAddress | null {
  if (input.destination === "space") {
    return input.spaceId ? { kind: "space", spaceId: input.spaceId } : null;
  }
  if (input.destination === "direct") {
    // A direct message is addressed by email, which is the only Webex
    // identity the platform reliably holds for a reader. A watch recorded
    // before emails were stored has none, and is skipped rather than guessed.
    return input.email ? { kind: "direct", personEmail: input.email } : null;
  }
  return null;
}
