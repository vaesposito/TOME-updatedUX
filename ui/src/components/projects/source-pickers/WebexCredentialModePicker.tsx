"use client";

import { useEffect, useState } from "react";
import { Building2, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import type { WebexCredentialMode } from "@/types/projects";

interface Capability {
  available: boolean;
  provider: string;
  displayName: string;
  accountEmail?: string;
  reason?: string;
}

export function WebexCredentialModePicker({
  value,
  readOnly = false,
  onChange,
}: {
  value: WebexCredentialMode;
  readOnly?: boolean;
  onChange: (mode: WebexCredentialMode, provider: string) => void;
}) {
  const [capability, setCapability] = useState<Capability | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(
      "/api/projects/source-options?provider=webex&webex_mode=managed&capability_only=1",
    )
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        const candidate = body?.data?.managedCapability;
        setCapability(
          candidate && typeof candidate === "object"
            ? (candidate as Capability)
            : { available: false, provider: "webex_messaging", displayName: "Managed Webex account" },
        );
      })
      .catch(() => {
        if (!cancelled) {
          setCapability({
            available: false,
            provider: "webex_messaging",
            displayName: "Managed Webex account",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const showManaged = capability?.available === true || value === "managed";
  if (readOnly) {
    return (
      <p className="text-xs text-muted-foreground">
        Credential: {value === "managed" ? "Managed Webex account" : "My Webex connection"}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Webex credential</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          aria-pressed={value === "personal"}
          onClick={() => onChange("personal", "webex")}
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition",
            value === "personal"
              ? "border-primary bg-primary/5"
              : "border-border hover:bg-muted/40",
          )}
        >
          <UserRound className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="block text-sm font-medium">My Webex connection</span>
            <span className="block text-xs text-muted-foreground">Uses your connected account</span>
          </span>
        </button>
        {showManaged ? (
          <button
            type="button"
            aria-pressed={value === "managed"}
            disabled={!capability?.available}
            onClick={() =>
              onChange("managed", capability?.provider || "webex_messaging")
            }
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition",
              value === "managed"
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/40",
              !capability?.available && "cursor-not-allowed opacity-60",
            )}
          >
            <Building2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="block text-sm font-medium">Managed Webex account</span>
              <span className="block text-xs text-muted-foreground">
                Uses the deployment-managed messaging account
              </span>
            </span>
          </button>
        ) : null}
      </div>
      {value === "managed" && !capability?.available ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {capability?.reason || "Managed Webex account needs reconnection."}
        </p>
      ) : null}
    </div>
  );
}
