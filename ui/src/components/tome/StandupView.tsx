"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { MarkdownRenderer } from "@/components/shared/timeline/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import { BetaBadge } from "@/components/tome/BetaBadge";
import { PanelShell } from "@/components/tome/PanelHeader";
import { ViewOnlyTooltip } from "@/components/tome/ViewOnlyTooltip";
import {
  parseStandup,
  plainStandupHeadline,
  summarizeStandupHeadline,
} from "@/lib/tome/standup";
import type { GlossaryResolver } from "@/lib/tome/tome-links";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  /** Full frontmatter+body markdown of `standup.md`, or undefined if the
   * project hasn't been ingested yet. */
  markdown: string | undefined;
  onNavigate?: (path: string) => void;
  glossaryPreview?: GlossaryResolver;
  onStartIngest?: () => void;
  /** True for a BHAG/Area, whose primary action is synthesis. */
  isSynthesized?: boolean;
  canEdit?: boolean;
}

interface StandupSectionProps {
  title: string;
  icon: ReactNode;
  content: string;
  empty: string;
  className: string;
  iconClassName: string;
  onNavigate?: (path: string) => void;
  glossaryPreview?: GlossaryResolver;
}

function splitStandupItems(content: string): { primary: string; overflow: string } {
  const lines = content.split("\n");
  const itemStarts = lines
    .map((line, index) => (/^[-*+]\s+/.test(line) ? index : -1))
    .filter((index) => index >= 0);

  if (itemStarts.length <= 3) return { primary: content, overflow: "" };
  const overflowStart = itemStarts[3];
  return {
    primary: lines.slice(0, overflowStart).join("\n").trim(),
    overflow: lines.slice(overflowStart).join("\n").trim(),
  };
}

function StandupSection({
  title,
  icon,
  content,
  empty,
  className,
  iconClassName,
  onNavigate,
  glossaryPreview,
}: StandupSectionProps) {
  const items = splitStandupItems(content);

  return (
    <section className={cn("rounded-xl border bg-card p-5 shadow-sm", className)}>
      <div className="mb-4 flex items-center gap-2.5">
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", iconClassName)}>
          {icon}
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {content ? (
        <>
          <MarkdownRenderer
            content={items.primary}
            variant="final"
            className="text-sm [&_li]:leading-relaxed [&_ul]:space-y-2"
            onInternalLink={onNavigate}
            glossaryPreview={glossaryPreview}
          />
          {items.overflow && (
            <details className="group mt-4 border-t pt-3 text-sm">
              <summary className="cursor-pointer select-none font-medium text-muted-foreground hover:text-foreground">
                Show remaining updates
              </summary>
              <MarkdownRenderer
                content={items.overflow}
                variant="final"
                className="mt-3 text-sm [&_li]:leading-relaxed [&_ul]:space-y-2"
                onInternalLink={onNavigate}
                glossaryPreview={glossaryPreview}
              />
            </details>
          )}
        </>
      ) : (
        <p className="text-sm leading-relaxed text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

/**
 * The Standup surface — `standup.md`'s report card (headline / progress /
 * blockers / up-next), rewritten by the agent every ingest.
 * Excluded from the ordinary wiki tree (schema.ts `SURFACE_PATHS`); this is
 * its dedicated entry point (nav rail, see TomeWiki).
 */
export function StandupView({
  markdown,
  onNavigate,
  glossaryPreview,
  onStartIngest,
  isSynthesized,
  canEdit = true,
}: Props) {
  if (!markdown) {
    return (
      <PanelShell
        maxWidthClassName="max-w-4xl"
        contentClassName="flex min-h-[calc(100vh-10rem)] items-center"
      >
        <section className="relative w-full overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.09] via-background to-background p-6 text-center shadow-sm sm:p-10">
          <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative mx-auto max-w-2xl">
            <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="mb-2 flex items-center justify-center gap-2">
              <p className="text-xl font-semibold tracking-tight sm:text-2xl">
                Your next stand-up, written for you
              </p>
              <BetaBadge />
            </div>
            <p className="mx-auto max-w-xl text-sm leading-relaxed text-muted-foreground">
              {isSynthesized ? "Synthesize this wiki" : "Run an ingest"} to turn
              recent activity into a concise team update—not a commit log or a
              source-by-source recap.
            </p>

            <div className="mt-7 grid gap-3 text-left lg:grid-cols-3">
              <div className="rounded-xl border border-emerald-500/25 bg-background/70 p-4">
                <CheckCircle2 className="mb-3 h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                <p className="text-sm font-medium">Progress</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Outcomes that moved forward and why they matter.
                </p>
              </div>
              <div className="rounded-xl border border-amber-500/25 bg-background/70 p-4">
                <AlertTriangle className="mb-3 h-4 w-4 text-amber-600 dark:text-amber-300" />
                <p className="text-sm font-medium">Asks & blockers</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Active impediments and decisions the team needs.
                </p>
              </div>
              <div className="rounded-xl border border-blue-500/25 bg-background/70 p-4">
                <ArrowRight className="mb-3 h-4 w-4 text-blue-600 dark:text-blue-300" />
                <p className="text-sm font-medium">Up next</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Concrete commitments for the next reporting period.
                </p>
              </div>
            </div>

            {onStartIngest && (
              <div className="mt-7 flex justify-center">
                <ViewOnlyTooltip viewOnly={!canEdit}>
                  <Button
                    size="sm"
                    onClick={onStartIngest}
                    className="gap-1.5 shadow-sm"
                    disabled={!canEdit}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {isSynthesized ? "Start a synthesis" : "Start an ingest"}
                  </Button>
                </ViewOnlyTooltip>
              </div>
            )}
          </div>
        </section>
      </PanelShell>
    );
  }

  const s = parseStandup(markdown);
  const headline = summarizeStandupHeadline(s.headline);
  const fullHeadline = plainStandupHeadline(s.headline);

  return (
    <PanelShell maxWidthClassName="max-w-5xl" contentClassName="space-y-5 pb-10">
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.09] via-background to-background p-6 shadow-sm sm:p-8">
        <div className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative max-w-3xl space-y-3">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            The Standup
            <BetaBadge />
          </span>
          {headline ? (
            <Tooltip className="block w-full">
              <TooltipTrigger asChild>
                <h1
                  tabIndex={0}
                  className="line-clamp-2 cursor-help rounded-sm text-xl font-semibold leading-tight tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:text-2xl"
                >
                  {headline}
                </h1>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                sideOffset={8}
                className="w-[min(32rem,calc(100vw-2rem))] whitespace-normal p-3 text-left text-xs font-normal leading-relaxed"
              >
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Full headline
                </span>
                {fullHeadline}
              </TooltipContent>
            </Tooltip>
          ) : (
            <h1 className="text-xl font-semibold leading-tight text-muted-foreground sm:text-2xl">
              No headline yet
            </h1>
          )}
        </div>
      </section>

      {s.fallback ? (
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <MarkdownRenderer
            content={s.fallback}
            variant="final"
            onInternalLink={onNavigate}
            glossaryPreview={glossaryPreview}
          />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <StandupSection
            title="Progress"
            icon={<CheckCircle2 className="h-4 w-4" />}
            content={s.progress}
            empty="No material progress was captured for this update."
            className="border-emerald-500/25"
            iconClassName="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            onNavigate={onNavigate}
            glossaryPreview={glossaryPreview}
          />
          <StandupSection
            title="Asks & blockers"
            icon={<AlertTriangle className="h-4 w-4" />}
            content={s.blockers}
            empty="Nothing is blocking the team right now."
            className="border-amber-500/25"
            iconClassName="bg-amber-500/10 text-amber-700 dark:text-amber-300"
            onNavigate={onNavigate}
            glossaryPreview={glossaryPreview}
          />
          <StandupSection
            title="Up next"
            icon={<ArrowRight className="h-4 w-4" />}
            content={s.upNext}
            empty="No next step was captured for this update."
            className="border-blue-500/25"
            iconClassName="bg-blue-500/10 text-blue-700 dark:text-blue-300"
            onNavigate={onNavigate}
            glossaryPreview={glossaryPreview}
          />
        </div>
      )}
    </PanelShell>
  );
}
