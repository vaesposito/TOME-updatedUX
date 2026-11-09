/**
 * Who last wrote a wiki page, and what kind of writing it was.
 *
 * A page's newest revision carries only an author handle and a timestamp,
 * which on their own do not distinguish a colleague's edit from a machine
 * rewrite. This turns that pair into the two things a reader needs out loud:
 * whose hand it was, and what the date is the date of.
 *
 * Pure: a revision goes in, a phrase comes out. No React, no fetch.
 */

import { AGENT_IDENTITIES } from "@/lib/tome/agent-identities";

/** Whose hand wrote the revision — decides which icon stands beside it. */
export type PageAuthorKind = "person" | "ingest" | "agent";

export interface PageAuthor {
  kind: PageAuthorKind;
  /** The name to show: a person's own, or what Tome did the writing as. */
  name: string;
}

export interface PageUpdate {
  kind: PageAuthorKind;
  /** Names the change and its author: "Edited by Alex Doe". */
  attribution: string;
  /** How long ago, said relatively: "3d ago". */
  when: string;
  /** The raw author and instant, for the element's own title attribute. */
  author: string;
  at: string;
}

/**
 * A person's name as they would write it, from the handle a revision stores.
 *
 * Revisions record an email, which is both long for a header line and the
 * wrong register for "who wrote this". The local part, de-punctuated, is how
 * people are addressed everywhere else in the product.
 */
function personName(author: string): string {
  const local = author.includes("@") ? author.slice(0, author.indexOf("@")) : author;
  const words = local.split(/[._-]+/).filter(Boolean);
  if (words.length === 0) return author;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function readPageAuthor(author: string): PageAuthor {
  const handle = author.trim();
  if (handle === AGENT_IDENTITIES.ingestor) return { kind: "ingest", name: "ingest" };
  if (handle === AGENT_IDENTITIES.default || !handle) {
    return { kind: "agent", name: "Tome" };
  }
  return { kind: "person", name: personName(handle) };
}

/** The verb that says what the revision's date is the date of. */
function verbFor(kind: PageAuthorKind): string {
  if (kind === "ingest") return "Rewritten";
  if (kind === "agent") return "Written";
  return "Edited";
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function readPageUpdate(
  revision: { author: string; created_at: string } | null | undefined,
  now: Date = new Date(),
): PageUpdate | null {
  if (!revision) return null;
  const { kind, name } = readPageAuthor(revision.author);
  return {
    kind,
    attribution: `${verbFor(kind)} by ${name}`,
    when: relativeTime(revision.created_at, now),
    author: revision.author,
    at: revision.created_at,
  };
}

export interface PageRevisionLike {
  id?: string;
  author: string;
  created_at: string;
  /** Absent on older rows, which predate review and are therefore live. */
  status?: string | null;
  deleted?: boolean | null;
}

/**
 * The revisions that produced the text on screen, newest first.
 *
 * A page's history also holds drafts awaiting review and drafts that were
 * rejected. Neither is what a reader is reading, so neither may be reported
 * as the page's last change.
 */
export function liveRevisions(
  revisions: readonly PageRevisionLike[],
): PageRevisionLike[] {
  return revisions
    .filter(
      (revision) =>
        (!revision.status || revision.status === "live") && !revision.deleted,
    )
    .slice()
    .sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
}

export interface PageProvenance {
  /** The change that produced what is on screen. */
  latest: PageUpdate;
  /**
   * The last time a person wrote the page, when a machine wrote it since.
   * Null when the latest change is already that person's, so the same fact
   * is never said twice.
   */
  lastEdit: PageUpdate | null;
}

/**
 * What to say about a page's history: its last change, and — when the agent
 * has written over it since — when a person last had their hands on it.
 */
export function readPageProvenance(
  revisions: readonly PageRevisionLike[],
  now: Date = new Date(),
): PageProvenance | null {
  const live = liveRevisions(revisions);
  const latest = readPageUpdate(live[0], now);
  if (!latest) return null;
  if (latest.kind === "person") return { latest, lastEdit: null };
  const edit = live.find((revision) => readPageAuthor(revision.author).kind === "person");
  return { latest, lastEdit: readPageUpdate(edit, now) };
}
