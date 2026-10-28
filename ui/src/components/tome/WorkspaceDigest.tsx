"use client";

/**
 * The hub's Digest tab: last week across every space, written out in prose.
 *
 * The layout only. Nothing here is generated yet and nothing is read from a
 * space — the text below is a sample of the shape the writing will take, so
 * the page can be reviewed and argued with before anything is built to fill
 * it. Every space it names is invented. The controls are present and inert
 * for the same reason: a reader should be able to see that a digest can be
 * shared, copied, re-run and configured without any of that existing yet.
 */

import {
  Check,
  Copy,
  RefreshCw,
  Settings2,
  Share2,
  Sparkles,
} from "lucide-react";
import * as React from "react";

import { DigestConfigPanel } from "@/components/tome/DigestConfigPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The shape of a digest, stood in for.
 *
 * Kept as data rather than written into the JSX so that the thing which
 * replaces it has an obvious shape to produce, and so that the page cannot
 * quietly grow prose that only exists as a mock.
 */
const SAMPLE = {
  day: "Thursday, Oct 15",
  written: "Written 10:26 AM, covers since Oct 8",
  lede: "Three decisions landed this week and two are still open. Most of the movement was in the platform area, where the gateway work closed out its last two questions; the onboarding project has gone quiet for nine days and nobody has said why.",
  waiting: [
    {
      title: "Pick a retention window for ingested pages",
      space: "Example Platform Area",
      detail: "Open 11 days. Two options written up, no owner named.",
    },
    {
      title: "Confirm the second reviewer for the charter",
      space: "Example Onboarding Project",
      detail: "Asked twice. Last reply was a week ago.",
    },
  ],
  moved: [
    {
      title: "Gateway hardening closed its last two decisions",
      space: "Example Platform Area",
      detail:
        "Rate limiting and the audit trail are both settled and written up on the decisions page.",
    },
    {
      title: "Skills catalogue grew by three pages",
      space: "Example Developer Experience Area",
      detail: "All three came from the repository, none have been reviewed.",
    },
    {
      title: "Observability baseline hit its first milestone",
      space: "Example Reliability Project",
      detail: "The roadmap page moved it to done on Tuesday.",
    },
  ],
} as const;

export function WorkspaceDigest() {
  const [copied, setCopied] = React.useState(false);
  /**
   * In place of the digest rather than beside it: the configuration is about
   * the thing it replaces, and a reader reading one is not reading the other.
   */
  const [configuring, setConfiguring] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (configuring) {
    return <DigestConfigPanel onBack={() => setConfiguring(false)} />;
  }

  return (
    /* A digest is prose, so it is held to a reading measure and centred
       rather than let out to the width of the page. The cap is on the
       column, not on the paragraphs inside it, so the text reaches the
       card's edge instead of stopping short of it. */
    <div className="mx-auto max-w-[68ch] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Digest</h2>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setConfiguring(true)}
        >
          <Settings2 className="h-3.5 w-3.5" />
          Configure digest
        </Button>
      </div>

      <Card className="overflow-hidden p-0">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {SAMPLE.day}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {SAMPLE.written}
            </p>
          </div>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled>
              <Share2 className="h-3.5 w-3.5" />
              <span className="sr-only">Share this digest</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setCopied(true)}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span className="sr-only">Copy this digest</span>
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled>
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="sr-only">Write it again</span>
            </Button>
          </div>
        </header>

        <div className="space-y-6 px-5 py-5">
          {/* Said plainly and at the top, because a reader who stops after one
              paragraph should still have been told the useful part. */}
          <p className="text-sm leading-relaxed text-foreground">
            {SAMPLE.lede}
          </p>

          <Section title="Needs a person" tone="attention">
            {SAMPLE.waiting.map((entry) => (
              <Line key={entry.title} {...entry} />
            ))}
          </Section>

          <Section title="What moved">
            {SAMPLE.moved.map((entry) => (
              <Line key={entry.title} {...entry} />
            ))}
          </Section>
        </div>

        <footer className="flex items-center gap-2 border-t border-border bg-muted/30 px-5 py-3">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-[11px] text-muted-foreground">
            A sample, to show what a digest reads like. Nothing above is drawn
            from your spaces yet.
          </p>
        </footer>
      </Card>
    </div>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "attention";
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3
        className={cn(
          "mb-2 text-[11px] font-semibold uppercase tracking-wider",
          tone === "attention"
            ? "text-amber-600 dark:text-amber-400"
            : "text-muted-foreground",
        )}
      >
        {title}
      </h3>
      <ul className="space-y-2.5">{children}</ul>
    </section>
  );
}

function Line({
  title,
  space,
  detail,
}: {
  title: string;
  space: string;
  detail: string;
}) {
  return (
    <li className="flex min-w-0 gap-2.5">
      <span
        aria-hidden
        className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60"
      />
      <div className="min-w-0">
        {/* A span, not a paragraph: the badge beside the title is a div. */}
        <span className="block text-sm leading-snug text-foreground">
          {title}{" "}
          <Badge
            variant="secondary"
            className="ml-1 align-middle text-[10px] font-normal"
          >
            {space}
          </Badge>
        </span>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {detail}
        </p>
      </div>
    </li>
  );
}
