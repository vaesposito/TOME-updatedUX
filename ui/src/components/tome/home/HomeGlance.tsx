"use client";

import { Activity, CircleAlert, CornerDownRight } from "lucide-react";
import * as React from "react";

import { MarkdownRenderer } from "@/components/shared/timeline/MarkdownRenderer";
import {
  HomeCard,
  HomeEmpty,
  HomeSkeleton,
  homeAction,
} from "@/components/tome/home/HomeCard";
import {
  parseStandup,
  summarizeStandupHeadline,
} from "@/lib/tome/standup";

/**
 * How the project is doing, in its own words.
 *
 * The standup page is rewritten on every ingest and already answers the
 * question a home page exists to answer, so this shows its headline and the
 * two sections a reader acts on — what is in the way, and what is next.
 * Progress is left to the standup page itself: it is the long part, and a
 * reader who wants the history is one click from it.
 */
export function HomeGlance({
  markdown,
  standupHref,
  ingestHref,
  onOpenStandup,
  onOpenIngest,
  onNavigate,
  container = false,
  loading = false,
  className,
}: {
  /** The standup page, or null when the project has none. */
  markdown: string | null;
  standupHref: string;
  /** Where an ingest is started, which is what writes the standup. */
  ingestHref: string;
  /**
   * Whether this space holds other spaces rather than work of its own.
   *
   * Only the wording changes. A BHAG's standup is still its own standup,
   * written at its own altitude by the same agent on the same page — what
   * differs is that nobody connects a repository to a BHAG, so telling its
   * reader to go and do that would send them to the wrong place.
   */
  container?: boolean;
  /**
   * Whether the page this reads is still on its way.
   *
   * Waiting and empty must not look alike: telling a reader the space has no
   * standup, a moment before one arrives, is worse than telling them nothing
   * yet.
   */
  loading?: boolean;
  onOpenStandup?: () => void;
  onOpenIngest?: () => void;
  onNavigate?: (href: string) => void;
  className?: string;
}) {
  const standup = React.useMemo(
    () => (markdown ? parseStandup(markdown) : null),
    [markdown],
  );
  const headline = standup ? summarizeStandupHeadline(standup.headline) : "";
  const blockers = standup?.blockers?.trim() ?? "";
  const upNext = standup?.upNext?.trim() ?? "";
  const anything = Boolean(headline || blockers || upNext || standup?.fallback);

  return (
    <HomeCard
      title="At a glance"
      icon={<Activity className="h-4 w-4" />}
      className={className}
      action={homeAction("Standup", standupHref, onOpenStandup)}
    >
      {loading ? (
        <HomeSkeleton />
      ) : !anything ? (
        <HomeEmpty
          icon={<Activity />}
          headline="No standup yet"
          hint={
            container
              ? "The agent writes one when it synthesizes, drawing on everything below this."
              : "The agent writes one on every ingest, summarising where the work stands."
          }
          action={homeAction(
            container ? "Ingest & synthesize" : "Run an ingest",
            ingestHref,
            onOpenIngest,
          )}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {headline ? (
            <p className="text-sm font-medium leading-snug">{headline}</p>
          ) : (
            standup?.fallback && (
              <MarkdownRenderer
                content={standup.fallback}
                variant="final"
                className="text-xs [&_li]:leading-relaxed [&_p]:leading-relaxed"
                onInternalLink={onNavigate}
              />
            )
          )}

          {blockers && (
            <GlanceSection
              title="Blockers"
              icon={
                <CircleAlert
                  className="h-3.5 w-3.5 text-destructive"
                  aria-hidden="true"
                />
              }
              content={blockers}
              onNavigate={onNavigate}
            />
          )}
          {upNext && (
            <GlanceSection
              title="Up next"
              icon={
                <CornerDownRight
                  className="h-3.5 w-3.5 text-muted-foreground"
                  aria-hidden="true"
                />
              }
              content={upNext}
              onNavigate={onNavigate}
            />
          )}
        </div>
      )}
    </HomeCard>
  );
}

function GlanceSection({
  title,
  icon,
  content,
  onNavigate,
}: {
  title: string;
  icon: React.ReactNode;
  content: string;
  onNavigate?: (href: string) => void;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </p>
      <MarkdownRenderer
        content={content}
        variant="final"
        // Tight, and the bullet markers go: inside a card this narrow the
        // markers cost a column of width and the lines are plainly a list
        // without them.
        className="text-xs [&_li]:leading-relaxed [&_ul]:list-none [&_ul]:space-y-1 [&_ul]:pl-0 [&_p]:leading-relaxed"
        onInternalLink={onNavigate}
      />
    </div>
  );
}
