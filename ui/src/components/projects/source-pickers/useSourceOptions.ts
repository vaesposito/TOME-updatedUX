"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GitHubRepositorySource } from "@/types/projects";
import type { WebexCredentialMode } from "@/types/projects";

export interface SourceOption {
  value: string;
  label: string;
  github_repo?: GitHubRepositorySource;
}

export interface SourceOptionsState {
  connected: boolean;
  connectedTo?: string;
  options: SourceOption[];
  loading: boolean;
  error?: string;
  /** Connections page URL when that feature is enabled here, else null. */
  manageUrl: string | null;
  managedCapability?: {
    enabled: boolean;
    configured: boolean;
    available: boolean;
    provider: string;
    displayName: string;
    accountEmail?: string;
    reason?: string;
  };
}

type Loaded = Omit<SourceOptionsState, "loading">;

const EMPTY_STATE: SourceOptionsState = {
  connected: false,
  options: [],
  loading: true,
  manageUrl: null,
};

/** Pure fetch — no React state — so callers control when state updates. */
async function loadSourceOptions(
  provider: "github" | "atlassian" | "webex",
  q?: string,
  webexMode?: WebexCredentialMode,
  webexCredentialProvider?: string,
  forceRefresh = false,
): Promise<Loaded> {
  const params = new URLSearchParams({ provider });
  if (q) params.set("q", q);
  if (provider === "webex" && webexMode) params.set("webex_mode", webexMode);
  if (provider === "webex" && webexCredentialProvider) {
    params.set("credential_provider", webexCredentialProvider);
  }
  if (forceRefresh) params.set("refresh", "1");
  const url = `/api/projects/source-options?${params}`;
  const res = await fetch(url);
  const json = await res.json();
  const d = json?.data ?? {};
  return {
    connected: Boolean(d.connected),
    connectedTo: typeof d.connectedTo === "string" ? d.connectedTo : undefined,
    options: Array.isArray(d.options) ? d.options : [],
    error: typeof d.error === "string" ? d.error : undefined,
    manageUrl: typeof d.manageUrl === "string" ? d.manageUrl : null,
    managedCapability:
      d.managedCapability && typeof d.managedCapability === "object"
        ? d.managedCapability
        : undefined,
  };
}

/**
 * Live-fetch a connected provider's resources from `/api/projects/source-options`
 * (the same endpoint the Connections tab feeds) + a debounced `search`. This is
 * the data behind the "connect → see your actual repos/spaces → pick" pickers.
 */
export function useSourceOptions(
  provider: "github" | "atlassian" | "webex",
  options?: {
    webexMode?: WebexCredentialMode;
    webexCredentialProvider?: string;
  },
): SourceOptionsState & { search: (q: string) => void; reload: () => void } {
  const webexMode = options?.webexMode;
  const webexCredentialProvider = options?.webexCredentialProvider;
  const key = JSON.stringify([provider, webexMode, webexCredentialProvider]);
  const [result, setResult] = useState({ key, data: EMPTY_STATE });
  // Discard rather than cache the previous account's results, including when
  // switching back before the intervening account's request has finished.
  if (result.key !== key) setResult({ key, data: EMPTY_STATE });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);
  const previousKey = useRef<string | null>(null);

  // Account changes hide the old results immediately (see return below), then
  // bypass the server cache. Neither old searches nor refreshes may replace them.
  useEffect(() => {
    const id = ++requestId.current;
    const switchedAccount = previousKey.current !== null && previousKey.current !== key;
    previousKey.current = key;
    loadSourceOptions(
      provider,
      undefined,
      webexMode,
      webexCredentialProvider,
      switchedAccount,
    )
      .then((d) => {
        if (id === requestId.current) setResult({ key, data: { ...d, loading: false } });
      })
      .catch(() => {
        if (id === requestId.current) {
          setResult({ key, data: { ...EMPTY_STATE, loading: false, error: "Unable to load sources. Try refreshing." } });
        }
      });
    return () => {
      requestId.current += 1;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [provider, webexMode, webexCredentialProvider, key]);

  // Event-handler refetch (allowed to setState directly).
  const run = useCallback(
    (q?: string, forceRefresh = false) => {
      if (timer.current) clearTimeout(timer.current);
      const id = ++requestId.current;
      setResult((s) => ({
        key,
        data: { ...(s.key === key ? s.data : EMPTY_STATE), loading: true },
      }));
      loadSourceOptions(
        provider,
        q,
        webexMode,
        webexCredentialProvider,
        forceRefresh,
      )
        .then((d) => {
          if (id === requestId.current) setResult({ key, data: { ...d, loading: false } });
        })
        .catch(() => {
          if (id === requestId.current) {
            setResult({ key, data: { ...EMPTY_STATE, loading: false, error: "Unable to load sources. Try refreshing." } });
          }
        });
    },
    [provider, webexMode, webexCredentialProvider, key],
  );

  const search = useCallback(
    (q: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => run(q.trim() || undefined), 300);
    },
    [run],
  );

  const reload = useCallback(() => run(undefined, true), [run]);

  return { ...(result.key === key ? result.data : EMPTY_STATE), search, reload };
}
