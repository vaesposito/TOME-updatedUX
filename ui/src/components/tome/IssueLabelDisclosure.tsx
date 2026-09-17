"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { usePersistentDisclosure } from "@/lib/tome/use-persistent-disclosure";
import { cn } from "@/lib/utils";

const ISSUE_LABEL_VIEWS_EXPANDED_KEY_PREFIX = "tome.issue-label-views.expanded.";

export function IssueLabelDisclosure({
  slug,
  controlsId,
  header,
  actions,
  collapsible = true,
  children,
}: {
  slug: string;
  controlsId: string;
  header: ReactNode;
  actions: ReactNode;
  collapsible?: boolean;
  children: ReactNode;
}) {
  const [storedExpanded, setExpanded] = usePersistentDisclosure(
    `${ISSUE_LABEL_VIEWS_EXPANDED_KEY_PREFIX}${slug}`,
  );
  const expanded = collapsible ? storedExpanded : true;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">{header}</div>
        {collapsible && (
          <button
            type="button"
            aria-label={expanded ? "Collapse issue label views" : "Expand issue label views"}
            aria-expanded={expanded}
            aria-controls={controlsId}
            title={expanded ? "Collapse issue label views" : "Expand issue label views"}
            onClick={() => setExpanded(!expanded)}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                expanded && "rotate-90",
              )}
            />
          </button>
        )}
        {actions}
      </div>
      {(expanded || !collapsible) && <div id={controlsId}>{children}</div>}
    </div>
  );
}
