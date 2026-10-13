"use client";

import { AtSign, CircleAlert, Newspaper } from "lucide-react";
import * as React from "react";

import { HomeAskAgent } from "@/components/tome/home/HomeAskAgent";
import { HomeCard, HomeEmpty } from "@/components/tome/home/HomeCard";
import { HomeGlance } from "@/components/tome/home/HomeGlance";
import { HomeKpis } from "@/components/tome/home/HomeKpis";
import { HomeMilestones } from "@/components/tome/home/HomeMilestones";
import { HomeNotificationList } from "@/components/tome/home/HomeNotificationRow";
import { HomeSources } from "@/components/tome/home/HomeSources";
import { HomeTeam } from "@/components/tome/home/HomeTeam";
import { splitHomeFeeds } from "@/components/tome/home/home-feeds";
import { wikiPageHref } from "@/lib/tome/wiki-page-href";
import type { TomeSummary, TomeSummaryItem } from "@/types/tome-summary";

/**
 * A project's home page.
 *
 * The landing view used to be a digest of recent notifications, which told a
 * reader what had happened but not what the project was. This answers the
 * questions someone actually arrives with — what is this, who is on it, how
 * is it going, what wants me, where does it get its knowledge — and keeps the
 * recent activity as one card among those rather than as the whole page.
 *
 * Most of it costs nothing to show: the curated pages are already loaded for
 * the wiki beside it, and the notification cards all come out of the one
 * summary read the old digest made. Only the roster is a request of its own.
 */

/** Rows per notification card. Enough to be useful, short enough to scan. */
const FEED_LIMIT = 5;

const STANDUP_PAGE = "standup.md";
const ROADMAP_PAGE = "roadmap.md";
const CHARTER_PAGE = "charter.md";

export function ProjectHomeView({
  slug,
  title,
  pages,
  sources,
  onAsk,
  onOpenPage,
  onOpenStandup,
  onOpenSettings,
  onOpenIngest,
  onNavigate,
}: {
  slug: string;
  /** The space's own name, used where the page addresses the reader. */
  title: string;
  /** Every page's markdown, as the wiki beside this already holds it. */
  pages?: Record<string, string>;
  sources: Record<string, unknown> | null;
  onAsk: (question: string) => void;
  onOpenPage?: (path: string) => void;
  onOpenStandup?: () => void;
  onOpenSettings?: () => void;
  onOpenIngest?: () => void;
  onNavigate?: (href: string) => void;
}) {
  const [summary, setSummary] = React.useState<TomeSummary | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    // The whole space, as the digest read it: the cards below divide it up
    // themselves, and narrowing it here would only cost another request when
    // a reader wanted the rest.
    fetch(`/api/projects/${encodeURIComponent(slug)}/summary?scope=all`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body) => {
        if (!cancelled) setSummary((body?.data ?? body) as TomeSummary);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const feeds = React.useMemo(() => splitHomeFeeds(summary), [summary]);

  /** Following a row is what "I have read it" means, as in the inbox. */
  const markRead = React.useCallback((item: TomeSummaryItem) => {
    setSummary((current) =>
      current
        ? {
            ...current,
            counts: {
              ...current.counts,
              unread: Math.max(0, current.counts.unread - 1),
            },
            sections: current.sections.map((section) => ({
              ...section,
              items: section.items.map((row) =>
                row.id === item.id ? { ...row, read: true } : row,
              ),
            })),
          }
        : current,
    );
    void fetch(`/api/notifications/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      keepalive: true,
    }).catch(() => undefined);
  }, []);

  const page = (path: string) => pages?.[path] ?? null;
  const openPage = (path: string) =>
    onOpenPage ? () => onOpenPage(path) : undefined;

  /**
   * Everything this space has sent, where it can be worked through.
   *
   * On the All tab, not the inbox's usual Unread: these cards show what is
   * there rather than what is new, so a reader following one of them to "see
   * the rest" has often read the rest already.
   */
  const inboxHref = `/notifications?entity=${encodeURIComponent(slug)}&tab=all`;

  const unreachable = failed ? (
    <HomeEmpty>Could not load recent activity.</HomeEmpty>
  ) : null;

  return (
    <div className="flex flex-col gap-4 p-5" data-tour="project-home">
      <HomeAskAgent title={title} onAsk={onAsk} />

      {/* Three columns on a wide window, one on a narrow one. The left two
          hold what is read as prose — how it is going, what happened — and
          the right column the reference material, which stays legible
          narrow. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <HomeGlance
          markdown={page(STANDUP_PAGE)}
          standupHref={wikiPageHref(slug, STANDUP_PAGE)}
          onOpenStandup={onOpenStandup}
          onNavigate={onNavigate}
          className="lg:col-span-2"
        />

        <HomeTeam slug={slug} onOpenSettings={onOpenSettings} />

        <HomeCard
          title="Needs attention"
          icon={<CircleAlert className="h-4 w-4" />}
          count={feeds.attention.length}
          action={{ label: "All", href: inboxHref }}
          className="lg:col-span-2"
        >
          <HomeNotificationList
            items={feeds.attention}
            viewing={slug}
            limit={FEED_LIMIT}
            onOpen={markRead}
            empty={
              unreachable ?? (
                <HomeEmpty>
                  Nothing is waiting on anyone. Unresolved problems and
                  decisions still to be made show up here.
                </HomeEmpty>
              )
            }
          />
        </HomeCard>

        <HomeCard
          title="Tagged for you"
          icon={<AtSign className="h-4 w-4" />}
          count={feeds.tagged.length}
          action={{ label: "All", href: inboxHref }}
        >
          <HomeNotificationList
            items={feeds.tagged}
            viewing={slug}
            limit={FEED_LIMIT}
            onOpen={markRead}
            empty={
              unreachable ?? (
                <HomeEmpty>
                  Nobody has tagged you here. A page that names you with an @
                  mention lands in this card.
                </HomeEmpty>
              )
            }
          />
        </HomeCard>

        <HomeCard
          title="Latest updates"
          icon={<Newspaper className="h-4 w-4" />}
          count={feeds.updates.length}
          action={{ label: "All", href: inboxHref }}
          className="lg:col-span-2"
        >
          <HomeNotificationList
            items={feeds.updates}
            viewing={slug}
            limit={FEED_LIMIT}
            onOpen={markRead}
            empty={unreachable ?? <HomeEmpty>Nothing has happened here yet.</HomeEmpty>}
          />
        </HomeCard>

        <HomeSources sources={sources} onOpenIngest={onOpenIngest} />

        <HomeMilestones
          markdown={page(ROADMAP_PAGE)}
          roadmapHref={wikiPageHref(slug, ROADMAP_PAGE)}
          onOpenRoadmap={openPage(ROADMAP_PAGE)}
          className="lg:col-span-2"
        />

        <HomeKpis
          markdown={page(CHARTER_PAGE)}
          charterHref={wikiPageHref(slug, CHARTER_PAGE)}
          onOpenCharter={openPage(CHARTER_PAGE)}
        />
      </div>
    </div>
  );
}
