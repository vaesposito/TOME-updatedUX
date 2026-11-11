"use client";

import { ReportProblemDialog } from "@/components/ticket/ReportProblemDialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HUB_CTA_CLASS } from "@/components/projects/hub-cta";
import { getConfig } from "@/lib/config";
import { cn } from "@/lib/utils";
import { MessageSquareWarning } from "lucide-react";
import { useState } from "react";

export interface TomeProductFeedbackProps {
  projectSlug?: string;
  pagePath?: string;
  /** ghost icon in toolbars; link as a labelled button in hero bands */
  variant?: "icon" | "link";
  className?: string;
}

/**
 * Entry point for TOME **product** feedback (issue #169): bugs, UX, missing
 * features — not wiki content correctness.
 */
export function TomeProductFeedback({
  projectSlug,
  pagePath,
  variant = "icon",
  className,
}: TomeProductFeedbackProps) {
  const [open, setOpen] = useState(false);
  const enabled =
    getConfig("reportProblemEnabled") && getConfig("ticketEnabled");

  if (!enabled) return null;

  const trigger =
    variant === "link" ? (
      // Shaped from the welcome band's one definition, so it stands level
      // with Connect via MCP next to it rather than at a size of its own.
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn(
          HUB_CTA_CLASS,
          "text-muted-foreground hover:text-foreground",
          className,
        )}
      >
        <MessageSquareWarning className="h-4 w-4" />
        Send feedback
      </Button>
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={
              className ?? "h-8 w-8 text-muted-foreground"
            }
            onClick={() => setOpen(true)}
            aria-label="Provide TOME product feedback"
          >
            <MessageSquareWarning className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Provide TOME product feedback
        </TooltipContent>
      </Tooltip>
    );

  return (
    <>
      {trigger}
      <ReportProblemDialog
        open={open}
        onOpenChange={setOpen}
        preselectedArea="TOME"
        tomeContext={{ projectSlug, pagePath }}
      />
    </>
  );
}
