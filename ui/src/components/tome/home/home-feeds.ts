import type {
  TomeSummary,
  TomeSummaryItem,
  TomeSummarySectionKey,
} from "@/types/tome-summary";

/**
 * Dividing a space's notifications between the cards on its home page.
 *
 * The summary endpoint files an item under every section it belongs to, which
 * suits a digest read top to bottom but not a page of cards sitting side by
 * side: the same row showing up in three of them reads as three things
 * happening. So each item lands in exactly one card, by what the reader would
 * do with it — answer it, read it, or know they were named in it.
 */
export interface HomeFeeds {
  /** Where the reader was named. Theirs to answer, so it leads. */
  tagged: TomeSummaryItem[];
  /** Unresolved problems and decisions waiting on someone. */
  attention: TomeSummaryItem[];
  /** Everything else that happened, newest first. */
  updates: TomeSummaryItem[];
}

const ATTENTION_SECTIONS: readonly TomeSummarySectionKey[] = [
  "attention",
  "open_decisions",
];

/**
 * An unparseable timestamp sorts as the epoch rather than poisoning the
 * comparison: `NaN` compares false both ways, which would leave the list in
 * whatever order the sections happened to yield.
 */
function time(item: TomeSummaryItem): number {
  const parsed = Date.parse(item.created_at);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function splitHomeFeeds(
  summary: TomeSummary | null | undefined,
): HomeFeeds {
  const seen = new Map<
    string,
    { item: TomeSummaryItem; sections: Set<TomeSummarySectionKey> }
  >();
  for (const section of summary?.sections ?? []) {
    for (const item of section.items) {
      const found = seen.get(item.id);
      if (found) found.sections.add(section.key);
      else seen.set(item.id, { item, sections: new Set([section.key]) });
    }
  }

  const feeds: HomeFeeds = { tagged: [], attention: [], updates: [] };
  const ordered = [...seen.values()].sort((a, b) => time(b.item) - time(a.item));
  for (const { item, sections } of ordered) {
    if (item.reason === "mentioned") {
      feeds.tagged.push(item);
      continue;
    }
    // Something settled needs nobody, however loudly it was raised at the
    // time, so it rejoins the record of what happened.
    const pressing =
      !item.resolved &&
      (item.needs_attention ||
        item.severity === "error" ||
        ATTENTION_SECTIONS.some((key) => sections.has(key)));
    if (pressing) feeds.attention.push(item);
    else feeds.updates.push(item);
  }
  return feeds;
}
