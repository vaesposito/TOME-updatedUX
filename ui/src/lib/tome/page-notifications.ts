/**
 * Notifications for wiki page saves.
 *
 * Three audiences hear about a save: people watching the entity, people
 * watching this particular page, and the extra recipients the editor tagged.
 * They share one notification, because someone who is both a watcher and
 * tagged should be told once rather than twice — which also means the
 * editor's toolbar note is addressed to all three at once.
 *
 * The exception is a person tagged inline in the page body with a message for
 * them alone. They are lifted out of the shared notification and sent their
 * own, so their message is not read by everyone watching.
 *
 * Server-only.
 */

import { createInAppNotification } from "@/lib/in-app-notifications.server";
import { getCollection } from "@/lib/mongodb";
import { pageIsImportant } from "@/lib/tome/criticality";
import { wikiPageHref } from "@/lib/tome/wiki-page-href";
import { listPageWatcherSubjects } from "@/lib/tome/watchers";
import type { User } from "@/types/mongodb";
import {
  PAGE_NOTIFY_NOTE_MAX,
  type PageNotifyOutcome,
  type PageNotifyRecipient,
  type PageNotifySelection,
} from "@/types/tome";

const EMPTY: PageNotifyOutcome = { notified: 0, team: null, unresolved: [] };

/**
 * The editor's note, flattened to a single line and clamped.
 *
 * Newlines are collapsed rather than preserved because the inbox gives the
 * message one truncated row, so a pasted paragraph would only ever show its
 * opening words while carrying the rest invisibly.
 */
function parseNote(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const note = value.replace(/\s+/g, " ").trim().slice(0, PAGE_NOTIFY_NOTE_MAX);
  return note || undefined;
}

export function parsePageNotifySelection(value: unknown): PageNotifySelection {
  const raw = value as Partial<PageNotifySelection> | null | undefined;
  // An absent or malformed body is a save that asked for nothing, which is
  // not the same as the editor's default. Defaults belong to the editor.
  if (!raw || typeof raw !== "object")
    return { team: false, important: false, users: [] };
  const users = Array.isArray(raw.users) ? raw.users : [];
  const note = parseNote(raw.note);
  return {
    team: raw.team === true,
    important: raw.important === true,
    users: users
      .map((user) => user as PageNotifyRecipient | null)
      .filter(
        (user): user is PageNotifyRecipient =>
          typeof user?.email === "string" && user.email.includes("@"),
      )
      .map((user) => {
        const personal = parseNote(user.note);
        return {
          email: user.email.trim().toLowerCase(),
          ...(personal ? { note: personal } : {}),
        };
      }),
    ...(note ? { note } : {}),
  };
}

/**
 * Map tagged emails to Keycloak subjects.
 *
 * Deliberately ignores any subject the client sent: a request body could
 * otherwise name an arbitrary subject and deliver a notification to someone
 * the caller never chose from the directory. The email is the only input we
 * trust, and it is resolved against the directory here.
 */
async function resolveSubjects(
  emails: readonly string[],
): Promise<{ byEmail: Map<string, string>; subjects: string[]; unresolved: string[] }> {
  if (emails.length === 0) return { byEmail: new Map(), subjects: [], unresolved: [] };
  const users = await getCollection<User>("users");
  const rows = await users
    .find({ email: { $in: [...emails] } })
    .project<{ email: string; keycloak_sub?: string; metadata?: { keycloak_sub?: string } }>({
      email: 1,
      keycloak_sub: 1,
      "metadata.keycloak_sub": 1,
    })
    .toArray();

  const bySubject = new Map<string, string>();
  for (const row of rows) {
    const subject = (row.keycloak_sub ?? row.metadata?.keycloak_sub)?.trim();
    if (subject) bySubject.set(row.email, subject);
  }
  return {
    byEmail: bySubject,
    subjects: [...new Set(bySubject.values())],
    unresolved: emails.filter((email) => !bySubject.has(email)),
  };
}

/**
 * Announce a page save.
 *
 * `excludeSubject` is the editor: nobody needs a notification about their own
 * save, even if they watch the entity or tagged themselves. Returns what was
 * actually delivered so the caller can tell the editor when a tagged person
 * could not be reached.
 */
export async function notifyPageSaved(input: {
  entitySlug: string;
  entityTitle: string;
  teamSlug?: string;
  pagePath: string;
  pageTitle: string;
  editorName: string;
  /** False when this save creates the page, so the wording can say so. */
  existed?: boolean;
  /** The saved body, read for the page's own criticality labels. */
  markdown?: string;
  selection: PageNotifySelection;
  excludeSubject?: string;
}): Promise<PageNotifyOutcome> {
  const taggedEmails = [...new Set(input.selection.users.map((user) => user.email))];
  const [{ byEmail, subjects: taggedSubjects, unresolved }, watcherSubjects] =
    await Promise.all([
      resolveSubjects(taggedEmails),
      listPageWatcherSubjects(input.entitySlug, input.pagePath),
    ]);

  // One message per person, first tag winning, so re-tagging someone in two
  // places cannot fan out into two notifications for the same save.
  const personal = new Map<string, string>();
  for (const user of input.selection.users) {
    if (!user.note) continue;
    const subject = byEmail.get(user.email);
    if (!subject || subject === input.excludeSubject || personal.has(subject)) continue;
    personal.set(subject, user.note);
  }

  const shared = [...new Set([...watcherSubjects, ...taggedSubjects])].filter(
    (subject) => subject !== input.excludeSubject && !personal.has(subject),
  );
  const teamSlug = input.selection.team ? input.teamSlug?.trim() || null : null;

  if (shared.length === 0 && personal.size === 0 && !teamSlug) {
    return { ...EMPTY, unresolved };
  }

  // Second-granular: a double-submit of the same save collapses into one
  // notification, while genuinely separate edits stay separate.
  const savedAt = new Date().toISOString().slice(0, 19);
  const created = input.existed === false;
  // Two independent ways for a save to matter: the page's own labels, which
  // the artifact carries whoever saves it, and the editor ticking the box for
  // this one edit. Either is enough; neither cancels the other.
  const important =
    pageIsImportant(input.markdown ?? "") || input.selection.important === true;
  const common = {
    action: created ? ("new" as const) : ("updated" as const),
    eventLabel: created ? "Page added" : "Page updated",
    // The editor's name is a field now, not part of the headline: the row
    // renders it on its own line, and leaving it here too said it twice.
    title: `${input.pageTitle} ${created ? "added" : "updated"}`,
    actorName: input.editorName,
    href: wikiPageHref(input.entitySlug, input.pagePath),
    // A wiki page is published material about the entity, so it files as
    // Collateral.
    category: "collateral" as const,
    needsAttention: important,
    sourceLabel: "Wiki",
    entitySlug: input.entitySlug,
    entityTitle: input.entityTitle,
  };

  const sends: Promise<unknown>[] = [];

  if (shared.length > 0 || teamSlug) {
    sends.push(
      createInAppNotification({
        ...common,
        eventKey: `tome.page.edit.${input.entitySlug}.${input.pagePath}.${savedAt}`,
        recipientUserSubjects: shared,
        recipientTeamSlugs: teamSlug ? [teamSlug] : [],
        // The editor's own words when they left any. The path is the fallback
        // rather than a prefix: the title already names the page and the link
        // goes straight to it, so repeating the path would crowd out the note.
        message: input.selection.note ?? input.pagePath,
        // Tagging someone is an explicit ask, so they also land in the inbox's
        // "Mentions and assigned" facet, not just the general list.
        mentionSubjects: taggedSubjects.filter((subject) => shared.includes(subject)),
      }),
    );
  }

  for (const [subject, note] of personal) {
    sends.push(
      createInAppNotification({
        ...common,
        // The subject is part of the key so these sit beside the shared
        // notification for the same save instead of colliding with it.
        eventKey: `tome.page.edit.${input.entitySlug}.${input.pagePath}.${savedAt}.${subject}`,
        recipientUserSubjects: [subject],
        recipientTeamSlugs: [],
        message: note,
        mentionSubjects: [subject],
      }),
    );
  }

  await Promise.all(sends);

  return { notified: shared.length + personal.size, team: teamSlug, unresolved };
}
