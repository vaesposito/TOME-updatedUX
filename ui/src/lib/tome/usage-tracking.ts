import { useEffect, useRef } from "react";
import type { TomeUsageViewKind } from "@/types/tome";

const SESSION_STORAGE_KEY = "tome:analytics-session-id";
let fallbackSessionId: string | null = null;
let lastViewKey = "";
let lastViewAt = 0;

function randomId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function analyticsSessionId(): string {
  if (typeof window === "undefined") return randomId();
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const created = randomId();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    fallbackSessionId ??= randomId();
    return fallbackSessionId;
  }
}

/** Best-effort client navigation telemetry. It never blocks or fails the Tome UI. */
export function trackTomeView(
  slug: string,
  viewKind: TomeUsageViewKind,
  pagePath?: string,
): void {
  if (typeof window === "undefined") return;
  const key = `${slug}:${viewKind}:${pagePath ?? ""}`;
  const now = Date.now();
  // React Strict Mode can remount effects immediately in development.
  if (lastViewKey === key && now - lastViewAt < 1_000) return;
  lastViewKey = key;
  lastViewAt = now;

  void fetch(
    `/api/tome/projects/${encodeURIComponent(slug)}/analytics/events`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({
        eventId: randomId(),
        analyticsSessionId: analyticsSessionId(),
        viewKind,
        ...(pagePath ? { pagePath } : {}),
      }),
    },
  ).catch(() => undefined);
}

/** Record successful navigation once; polling the current page does not add views. */
export function useTomeViewTracking(
  slug: string,
  viewKind: TomeUsageViewKind,
  pagePath: string | undefined,
  ready: boolean,
): void {
  const navigation = useRef({ key: "", recorded: false });
  useEffect(() => {
    const key = `${slug}:${viewKind}:${pagePath ?? ""}`;
    if (navigation.current.key !== key)
      navigation.current = { key, recorded: false };
    if (!ready || navigation.current.recorded) return;
    trackTomeView(slug, viewKind, pagePath);
    navigation.current.recorded = true;
  }, [slug, viewKind, pagePath, ready]);
}
