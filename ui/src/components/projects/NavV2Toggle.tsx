"use client";

/**
 * The switch for the new TOME navigation.
 *
 * It lives in Appearance, with the rest of the interface preferences. It is
 * a preference rather than a thing to do, and the front page is a greeting
 * and a list of projects.
 */

import * as React from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFeatureFlagStore } from "@/store/feature-flag-store";
import { cn } from "@/lib/utils";
import { PanelLeft } from "lucide-react";

export function NavV2Toggle({ className }: { className?: string }) {
  const enabled = useFeatureFlagStore((state) => state.isEnabled("tomeNavV2"));
  const toggle = useFeatureFlagStore((state) => state.toggle);
  const initialize = useFeatureFlagStore((state) => state.initialize);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    initialize();
    // The store reads localStorage, which the server render could not have
    // seen. Showing the real state only after mount keeps the two renders
    // identical instead of flipping the label under the reader.
    setReady(true);
  }, [initialize]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            role="switch"
            aria-checked={ready ? enabled : false}
            aria-label="New project navigation"
            onClick={() => toggle("tomeNavV2")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
              ready && enabled
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              className,
            )}
          >
            <PanelLeft className="h-3.5 w-3.5 shrink-0" />
            New navigation
            <span
              aria-hidden
              className={cn(
                "ml-0.5 rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                ready && enabled
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {ready && enabled ? "On" : "Off"}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          {ready && enabled
            ? "Showing the new project navigation: seven destinations, with page actions in Settings. Switch back at any time."
            : "Try the new project navigation: fewer rows, and every page action in Settings."}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
