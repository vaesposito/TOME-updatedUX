"use client";

import { useEffect, useState } from "react";

export function useMyAgentEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/tome/myagent/status", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((config: { enabled?: boolean } | null) => {
        if (active) setEnabled(config?.enabled === true);
      })
      .catch(() => {
        if (active) setEnabled(false);
      });
    return () => { active = false; };
  }, []);

  return enabled;
}
