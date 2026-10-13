import type {
  InAppNotificationCategory,
  NotificationAction,
} from "@/types/in-app-notification";
import type { ProjectType } from "@/types/projects";

/**
 * The summary: a digest of what has happened under one BHAG, Area or Project,
 * assembled from the same notifications that feed the inbox.
 *
 * The inbox answers "what is addressed to me, newest first". The summary answers
 * a different question — "what is the state of this part of the org" — so it
 * groups by what a reader intends to do with an item (act on it, note the
 * decision, catch up) rather than by arrival time.
 */

/** Scope toggle at the top of the summary. */
export type TomeSummaryScope = "for_me" | "all";

/**
 * Why a row is in the reader's summary, shown on the meta line.
 *
 * The mock calls this out per item ("you follow this BHAG"), and it is worth
 * keeping: a digest that spans a subtree will otherwise surface items the
 * reader has no idea why they are seeing.
 */
export type TomeSummaryReason =
  | "mentioned"
  | "addressed"
  | "watching"
  | "in_scope"
  | "adjacent";

export const TOME_SUMMARY_REASON_LABELS: Record<TomeSummaryReason, string> = {
  mentioned: "you were mentioned",
  addressed: "addressed to you",
  watching: "you follow this",
  in_scope: "",
  adjacent: "touches your work",
};

/** The buckets, in the order the summary renders them. */
export type TomeSummarySectionKey =
  | "attention"
  | "decided"
  | "open_decisions"
  | "team"
  | "elsewhere"
  | "wiki";

export interface TomeSummaryItem {
  id: string;
  title: string;
  message: string;
  href?: string;
  category: InAppNotificationCategory;
  severity: "info" | "success" | "warning" | "error";
  /** Meta-line phrasing, e.g. "Due in 2 days". */
  event_label: string;
  /**
   * What happened, in the Type filter's words. Carried from the stored row
   * rather than derived, so the summary calls a row what the inbox calls it.
   */
  action?: NotificationAction;
  entity_slug: string;
  entity_title: string;
  entity_type: ProjectType;
  reference?: string;
  /** Who made the change, shown under the headline. See the inbox's field. */
  actor_name?: string;
  created_at: string;
  /** Whole days since it was raised, for "Open 5 days". */
  open_days: number;
  read: boolean;
  needs_attention: boolean;
  resolved: boolean;
  reason: TomeSummaryReason;
  /** Whether the reader watches `entity_slug`, driving the Follow action. */
  following: boolean;
}

export interface TomeSummarySection {
  key: TomeSummarySectionKey;
  title: string;
  description: string;
  items: TomeSummaryItem[];
  /** Everything matching the section, so the footer can offer the rest. */
  total: number;
}

export interface TomeSummaryEntity {
  slug: string;
  title: string;
  type: ProjectType;
  /** The tier above, so a BHAG's projects can be grouped under their Area. */
  parent_slug?: string;
  /**
   * What this entity alone is asking of the reader.
   *
   * Counted while the digest walks its rows, so a container can say which of
   * its children wants something without a second read. Absent on a Project's
   * own summary, where the cards below already are the answer.
   */
  attention?: number;
  unread?: number;
  /** Newest thing seen from it, ISO. Absent when it has sent nothing. */
  latest_at?: string;
}

export interface TomeSummaryCounts {
  attention: number;
  decided: number;
  open_decisions: number;
  team: number;
  elsewhere: number;
  wiki: number;
  /** Children in scope, phrased by type in the summary line. */
  descendants: number;
  /** Resolved inside the digest window, for the "since" strip. */
  recently_resolved: number;
  /** Unread inside this subtree — the reader's own backlog here. */
  unread: number;
}

export interface TomeSummary {
  entity: TomeSummaryEntity;
  /** Self plus descendants; what "all of this entity" covers. */
  scope_entities: TomeSummaryEntity[];
  scope: TomeSummaryScope;
  /** Headline, e.g. "Four items need attention in IoC BHAG". */
  headline: string;
  counts: TomeSummaryCounts;
  sections: TomeSummarySection[];
  /** Start of the "since" window, ISO. */
  since: string;
  generated_at: string;
}
