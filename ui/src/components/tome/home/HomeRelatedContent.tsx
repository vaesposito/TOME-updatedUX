"use client";

import { FileSymlink } from "lucide-react";

import {
  HomeCard,
  HomeEmpty,
  HomeSkeleton,
  homeAction,
} from "@/components/tome/home/HomeCard";
import { RelatedContentBlock } from "@/components/tome/RelatedContent";
import type { RelatedContentRow } from "@/hooks/use-related-content";

/**
 * Pages in other spaces that tag this one.
 *
 * The two trees are disjoint, so a tag written on a page elsewhere is the
 * only thing that makes another team's work related to this space. Until
 * this card existed that connection was reachable only by noticing the rail
 * entry, which meant a reader arriving at Home could not tell that anybody
 * was pointing here at all.
 *
 * Distinct from "Tagged for you", which is the notification feed's answer to
 * who was named with an @ mention. That card is about a person and is made
 * of notifications; this one is about a space and is made of page tags. They
 * share no data and neither is a view of the other.
 *
 * The rows are the full view's own, through the same block, so a page is
 * named and described identically wherever this is read.
 */

/**
 * Rows a card shows before it says how many there are.
 *
 * Five, as every other card-level list on this page: a reader learns the
 * page's measure once and a card that stopped somewhere else would only
 * invite them to wonder why.
 */
const SHOWN = 5;

export function HomeRelatedContent({
  related,
  relatedHref,
  onOpenRelated,
}: {
  /**
   * The pages that tag this space, `undefined` while they are on their way.
   *
   * Handed down rather than read here: the shell around this already asks
   * the index for them to count the rail entry, and two readings of one
   * answer are two requests and two chances to disagree about the count.
   *
   * Waiting and empty must not look alike — telling a reader nothing points
   * at their space, a moment before naming four pages that do, is worse than
   * telling them nothing yet.
   */
  related?: readonly RelatedContentRow[];
  /** The whole list, which is the only place past the first few rows. */
  relatedHref: string;
  onOpenRelated?: () => void;
}) {
  return (
    <HomeCard
      title="Related content"
      icon={<FileSymlink className="h-4 w-4" />}
      count={related?.length}
      action={homeAction("All related", relatedHref, onOpenRelated)}
    >
      {!related ? (
        <HomeSkeleton rows={3} />
      ) : related.length === 0 ? (
        /* No way out of its own: the tag that would fill this card is
           written on a page in another space, so there is nothing in this
           one to send a reader to do it. The heading's link is the whole of
           what this card can honestly offer. */
        <HomeEmpty
          icon={<FileSymlink />}
          headline="Nothing tags this space yet"
          hint="A page in another space that tags this one appears here, with the space it lives in."
        />
      ) : (
        <>
          <RelatedContentBlock related={related.slice(0, SHOWN)} bare />
          {related.length > SHOWN && (
            <p className="mt-2 shrink-0 text-[11px] text-muted-foreground">
              and {related.length - SHOWN} more
            </p>
          )}
        </>
      )}
    </HomeCard>
  );
}
