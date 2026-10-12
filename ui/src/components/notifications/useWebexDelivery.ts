"use client";

import * as React from "react";

import { useToast } from "@/components/ui/toast";
import {
  DEFAULT_WEBEX_DELIVERY_HOUR,
  DEFAULT_WEBEX_DELIVERY_WEEKDAY,
  type WebexDeliveryCapability,
  type WebexDeliveryRule,
  type WebexDeliverySettings,
  type WebexDeliverySpace,
} from "@/types/webex-delivery";

const EMPTY: WebexDeliverySettings = {
  capability: { available: true },
  rules: [],
};

function unwrap<T>(value: unknown, fallback: T): T {
  const body = value as { data?: T } | null;
  return (body?.data ?? fallback) as T;
}

/** The reader's own zone, which is the only one a chosen hour can mean. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export interface WebexDeliveryState {
  capability: WebexDeliveryCapability;
  /** The rule for a watched entity, or a fresh unconfigured one. */
  ruleFor: (entity: {
    entity_slug: string;
    entity_title: string;
    entity_type: WebexDeliveryRule["entity_type"];
  }) => WebexDeliveryRule;
  save: (rule: WebexDeliveryRule) => void;
  spaces: readonly WebexDeliverySpace[];
  spacesState: { loading: boolean; error: string | null };
  /** Load the bot's spaces, at most once unless the last try failed. */
  needSpaces: () => void;
  busy: boolean;
}

/**
 * The reader's Webex delivery rules, for the Watching tab's rows to sit on.
 *
 * One fetch for the whole tree rather than one per row: the rules are a
 * short list the server can hand over in a single read, and a tree of
 * controls that each fetched their own state would stutter into place.
 *
 * Mount this only where delivery can be configured. Listing the bot's spaces
 * fans out across every configured bot, which is not a cost anyone should
 * pay for reading their inbox.
 */
export function useWebexDelivery(): WebexDeliveryState {
  const { toast } = useToast();
  const [settings, setSettings] = React.useState<WebexDeliverySettings>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const [spaces, setSpaces] = React.useState<readonly WebexDeliverySpace[]>([]);
  const [spacesState, setSpacesState] = React.useState<{
    loading: boolean;
    error: string | null;
    loaded: boolean;
  }>({ loading: false, error: null, loaded: false });

  React.useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const response = await fetch("/api/notifications/delivery", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = unwrap<WebexDeliverySettings>(await response.json(), EMPTY);
        if (!cancelled) setSettings(body);
      } catch {
        if (!cancelled) toast("Could not load Webex settings", "error");
      }
    };
    void read();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const loadSpaces = React.useCallback(async () => {
    setSpacesState((current) =>
      current.loading ? current : { ...current, loading: true, error: null },
    );
    try {
      const response = await fetch("/api/notifications/delivery?action=spaces", {
        method: "POST",
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = unwrap<{ spaces?: WebexDeliverySpace[] }>(
        await response.json(),
        {},
      );
      setSpaces(body.spaces ?? []);
      setSpacesState({ loading: false, error: null, loaded: true });
    } catch {
      setSpacesState({
        loading: false,
        error: "Could not reach Webex.",
        loaded: false,
      });
    }
  }, []);

  const needSpaces = React.useCallback(() => {
    if (spacesState.loaded && !spacesState.error) return;
    void loadSpaces();
  }, [loadSpaces, spacesState.error, spacesState.loaded]);

  const byslug = React.useMemo(
    () => new Map(settings.rules.map((rule) => [rule.entity_slug, rule])),
    [settings.rules],
  );

  /**
   * An unconfigured entity gets a rule made up on the spot rather than one
   * fetched: the server only stores a rule once there is something to store,
   * and the row still has to draw the controls that would create it.
   */
  const ruleFor = React.useCallback<WebexDeliveryState["ruleFor"]>(
    (entity) =>
      byslug.get(entity.entity_slug) ?? {
        ...entity,
        destination: "off",
        cadence: "immediate",
        hour: DEFAULT_WEBEX_DELIVERY_HOUR,
        weekday: DEFAULT_WEBEX_DELIVERY_WEEKDAY,
        timezone: browserTimezone(),
      },
    [byslug],
  );

  /**
   * Save one rule.
   *
   * The local change lands first so the controls stay responsive, then the
   * server's answer replaces the whole list — which is also how a rejected
   * rule rolls back without needing a second copy of the old one.
   */
  const save = React.useCallback(
    (next: WebexDeliveryRule) => {
      const previous = settings;
      setSettings((current) => ({
        ...current,
        rules: current.rules.some((rule) => rule.entity_slug === next.entity_slug)
          ? current.rules.map((rule) =>
              rule.entity_slug === next.entity_slug ? next : rule,
            )
          : [...current.rules, next],
      }));

      // A space rule with no space yet is a half-made choice, not something
      // to persist: the reader has opened the picker and not chosen.
      if (next.destination === "space" && !next.space_id) return;

      const write = async () => {
        setBusy(true);
        try {
          const response = await fetch("/api/notifications/delivery", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entity_slug: next.entity_slug,
              destination: next.destination,
              ...(next.space_id ? { space_id: next.space_id } : {}),
              ...(next.space_name ? { space_name: next.space_name } : {}),
              cadence: next.cadence,
              hour: next.hour,
              weekday: next.weekday,
              // Stamped from the browser on every save: the hour is
              // meaningless without the zone it was chosen in, and a reader
              // who has moved should get their new 9am.
              timezone: browserTimezone(),
            }),
          });
          const body = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(
              typeof body?.error === "string" ? body.error : "Could not save",
            );
          }
          setSettings(unwrap<WebexDeliverySettings>(body, previous));
        } catch (error) {
          setSettings(previous);
          toast(error instanceof Error ? error.message : "Could not save", "error");
        } finally {
          setBusy(false);
        }
      };
      void write();
    },
    [settings, toast],
  );

  return {
    capability: settings.capability,
    ruleFor,
    save,
    spaces,
    spacesState,
    needSpaces,
    busy,
  };
}
