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
  /** Connections page URL when that feature is enabled here, else null. */
  manageUrl: string | null;
  managedCapability?: {
    enabled: boolean;
    configured: boolean;
    available: boolean;
    provider: string;
    displayName: string;
    reason?: string;
  };
}

type Loaded = Omit<SourceOptionsState, "loading">;

/** Pure fetch — no React state — so callers control when state updates. */
async function loadSourceOptions(
  provider: "github" | "atlassian" | "webex",
  q?: string,
  webexMode?: WebexCredentialMode,
  webexCredentialProvider?: string,
): Promise<Loaded> {
  const params = new URLSearchParams({ provider });
  if (q) params.set("q", q);
  if (provider === "webex" && webexMode) params.set("webex_mode", webexMode);
  if (provider === "webex" && webexCredentialProvider) {
    params.set("credential_provider", webexCredentialProvider);
  }
  const url = `/api/projects/source-options?${params}`;
  const res = await fetch(url);
  const json = await res.json();
  const d = json?.data ?? {};
  return {
    connected: Boolean(d.connected),
    connectedTo: typeof d.connectedTo === "string" ? d.connectedTo : undefined,
    options: Array.isArray(d.options) ? d.options : [],
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
  const [state, setState] = useState<SourceOptionsState>({
    connected: false,
    options: [],
    loading: true,
    manageUrl: null,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial load: setState only inside the promise callback (not the effect body).
  useEffect(() => {
    let cancelled = false;
    loadSourceOptions(
      provider,
      undefined,
      options?.webexMode,
      options?.webexCredentialProvider,
    )
      .then((d) => !cancelled && setState({ ...d, loading: false }))
      .catch(() => !cancelled && setState((s) => ({ ...s, loading: false })));
    return () => {
      cancelled = true;
    };
  }, [provider, options?.webexMode, options?.webexCredentialProvider]);

  // Event-handler refetch (allowed to setState directly).
  const run = useCallback(
    (q?: string) => {
      setState((s) => ({ ...s, loading: true }));
      loadSourceOptions(
        provider,
        q,
        options?.webexMode,
        options?.webexCredentialProvider,
      )
        .then((d) => setState({ ...d, loading: false }))
        .catch(() => setState((s) => ({ ...s, loading: false })));
    },
    [provider, options?.webexMode, options?.webexCredentialProvider],
  );

  const search = useCallback(
    (q: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => run(q.trim() || undefined), 300);
    },
    [run],
  );

  const reload = useCallback(() => run(), [run]);

  return { ...state, search, reload };
}
