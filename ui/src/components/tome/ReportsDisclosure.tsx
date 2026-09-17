"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { BetaBadge } from "@/components/tome/BetaBadge";
import { cn } from "@/lib/utils";

const REPORTS_EXPANDED_KEY_PREFIX = "tome.reports.expanded.";
const REPORTS_EXPANDED_EVENT = "tome-reports-expanded-change";

export function ReportsDisclosure({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}) {
  const storageKey = `${REPORTS_EXPANDED_KEY_PREFIX}${slug}`;

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === storageKey) onStoreChange();
      };
      const onLocalChange = (event: Event) => {
        if ((event as CustomEvent<string>).detail === storageKey)
          onStoreChange();
      };
      window.addEventListener("storage", onStorage);
      window.addEventListener(REPORTS_EXPANDED_EVENT, onLocalChange);
      return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(REPORTS_EXPANDED_EVENT, onLocalChange);
      };
    },
    [storageKey],
  );
  const getSnapshot = useCallback(() => {
    const stored = window.localStorage.getItem(storageKey);
    return stored === null ? true : stored === "true";
  }, [storageKey]);
  const expanded = useSyncExternalStore(subscribe, getSnapshot, () => true);

  const toggle = () => {
    window.localStorage.setItem(storageKey, String(!expanded));
    window.dispatchEvent(
      new CustomEvent(REPORTS_EXPANDED_EVENT, { detail: storageKey }),
    );
  };

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={toggle}
        aria-label={expanded ? "Collapse Reports" : "Expand Reports"}
        aria-expanded={expanded}
        aria-controls={`tome-reports-${slug}`}
        className="flex w-full items-center gap-1 rounded-md px-2 pb-1.5 pt-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            expanded && "rotate-90",
          )}
        />
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider">
          Reports
        </span>
        <BetaBadge showTooltip={false} />
      </button>
      {expanded && (
        <div id={`tome-reports-${slug}`} className="mt-0.5 flex flex-col gap-1">
          {children}
        </div>
      )}
    </div>
  );
}
