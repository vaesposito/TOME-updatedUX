"use client";

// Visual identity for each page kind (stable / dynamic / hidden / report),
// with a tooltip explaining the kind's semantics. Used in the sidebar tree
// and the page header.

import { Anchor, Eye, FileText, Sparkles } from "lucide-react";
import type { ComponentType } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PageKind } from "@/types/tome";

type Spec = {
  label: string;
  Icon: ComponentType<{ className?: string }>;
  badgeClass: string; // background + border tint
  iconClass: string; // stroke color
  title: string;
  description: string;
};

export const PAGE_KIND_DESCRIPTIONS: Record<PageKind, string> = {
  stable:
    "Human-curated. Written once on greenfield ingest, then preserved across every reingest. Edit freely; your changes stick.",
  dynamic:
    "Custom prompts shape this page, and the agent writes it from what it ingests. Your own edits feed the next rewrite as context rather than surviving verbatim.",
  hidden:
    "Agent-only memory. Read by the synthesizers and chat, not surfaced in the wiki. Useful for project-specific instructions or notes you want the agent to keep in mind.",
  report:
    "A focused, structured surface, not a wiki page. Lives above the wiki and renders as its own UI element. Editable, but the agent rewrites it on each ingest like dynamic pages.",
};

/** The chip's own look, so a control that stands in for the badge (the page
 * header's kind toggle) reads as the same thing rather than a plain button. */
export const PAGE_KIND_SPECS: Record<PageKind, Spec> = {
  stable: {
    label: "stable",
    Icon: Anchor,
    badgeClass:
      "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-900/30 dark:text-emerald-300",
    iconClass: "text-emerald-700 dark:text-emerald-400",
    title: "Stable",
    description: PAGE_KIND_DESCRIPTIONS.stable,
  },
  dynamic: {
    label: "dynamic",
    Icon: Sparkles,
    badgeClass:
      "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-900/30 dark:text-sky-300",
    iconClass: "text-sky-700 dark:text-sky-400",
    title: "Dynamic",
    description: PAGE_KIND_DESCRIPTIONS.dynamic,
  },
  hidden: {
    label: "hidden",
    Icon: Eye,
    badgeClass:
      "border-neutral-300 bg-neutral-100 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-300",
    iconClass: "text-neutral-600 dark:text-neutral-400",
    title: "Hidden",
    description: PAGE_KIND_DESCRIPTIONS.hidden,
  },
  report: {
    label: "report",
    Icon: FileText,
    badgeClass:
      "border-primary bg-primary text-primary dark:border-primary/60 dark:bg-primary/30 dark:text-primary",
    iconClass: "text-primary dark:text-primary",
    title: "Report",
    description: PAGE_KIND_DESCRIPTIONS.report,
  },
};

export function KindBadge({
  kind,
  size = "sm",
  iconOnly = false,
  describe = true,
}: {
  kind: PageKind;
  size?: "xs" | "sm";
  iconOnly?: boolean;
  /**
   * Whether the mark explains itself on hover.
   *
   * Turned off where the thing holding the mark already explains the kind —
   * a menu row that carries its own tooltip, say. Both would open on the way
   * past, leaving two boxes over each other saying the same thing in
   * different words.
   */
  describe?: boolean;
}) {
  const spec = PAGE_KIND_SPECS[kind];
  const { Icon } = spec;

  const explanation = (
    <TooltipContent
      side="right"
      className="flex w-64 flex-col gap-1 whitespace-normal text-[11px] font-normal normal-case leading-relaxed"
    >
      <span className="text-xs font-semibold">{spec.title}</span>
      <span className="opacity-70">{spec.description}</span>
    </TooltipContent>
  );

  if (iconOnly) {
    const mark = (
      <span
        className="inline-flex cursor-default items-center text-neutral-400 dark:text-neutral-500"
        aria-label={spec.label}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
    );

    if (!describe) return mark;

    return (
      <Tooltip>
        <TooltipTrigger asChild>{mark}</TooltipTrigger>
        {explanation}
      </Tooltip>
    );
  }

  const sizing =
    size === "xs"
      ? "text-[9px] px-1 py-0 gap-0.5 h-auto"
      : "text-[10px] px-1.5 py-0.5 gap-1 h-auto";
  const iconSize = size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3";
  const badge = (
    <Badge
      variant="outline"
      className={`font-medium uppercase tracking-wide ${sizing} ${spec.badgeClass}`}
    >
      <Icon className={`${iconSize} ${spec.iconClass}`} />
      <span>{spec.label}</span>
    </Badge>
  );

  if (!describe) return badge;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      {explanation}
    </Tooltip>
  );
}
