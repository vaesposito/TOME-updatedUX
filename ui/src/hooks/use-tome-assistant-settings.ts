"use client";

import { useEffect, useState } from "react";

import {
  DEFAULT_TOME_ASSISTANT_SETTINGS,
  TOME_ASSISTANT_SETTINGS_EVENT,
  type TomeAssistantSettings,
} from "@/lib/tome/assistant-settings";

interface RuntimeSettings extends TomeAssistantSettings {
  agent_id: string | null;
}

const DEFAULT_SETTINGS: RuntimeSettings = { ...DEFAULT_TOME_ASSISTANT_SETTINGS, agent_id: null };

/** Refresh the server flag without persisting a user preference or requiring a rebuild. */
export function useTomeAssistantSettings(enabled = true): RuntimeSettings {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let controller: AbortController | null = null;
    async function refresh() {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const timeout = window.setTimeout(() => request.abort(), 10_000);
      try {
        const response = await fetch("/api/tome/assistant-settings", { cache: "no-store", signal: request.signal });
        if (!response.ok) throw new Error(`TOME settings returned HTTP ${response.status}`);
        const body = await response.json();
        if (active && controller === request) setSettings({
          tome_assistant_popup_enabled: body.data?.tome_assistant_popup_enabled === true,
          tome_live_verification_mode: body.data?.tome_live_verification_mode === "on_demand" || body.data?.tome_live_verification_mode === "automatic"
            ? body.data.tome_live_verification_mode : "off",
          agent_id: typeof body.data?.agent_id === "string" ? body.data.agent_id : null,
        });
      } catch (error) {
        // A failed refresh hides the optional popup; regular chat remains available.
        if (active && controller === request) {
          if (!request.signal.aborted) console.warn("[TOME assistant] Could not refresh settings", error);
          setSettings(DEFAULT_SETTINGS);
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }
    const refreshVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    const interval = window.setInterval(refreshVisible, 30_000);
    window.addEventListener("focus", refreshVisible);
    window.addEventListener(TOME_ASSISTANT_SETTINGS_EVENT, refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener(TOME_ASSISTANT_SETTINGS_EVENT, refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [enabled]);

  return settings;
}
