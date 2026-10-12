import { notificationAudienceQuery } from "@/lib/in-app-notifications.server";
import { getCollection } from "@/lib/mongodb";
import { wikiPagePathFromHref } from "@/lib/tome/wiki-page-href";
import type { InAppNotificationDocument } from "@/types/in-app-notification";

const NOTIFICATION_COLLECTION = "in_app_notifications";

/**
 * Which pages of one entity have activity the reader has not opened yet.
 *
 * This is what puts a dot in the wiki tree. It is derived from the reader's
 * own notifications rather than from the page's modification time, so the
 * dot means "new to you" and not "recently edited" — a page you just wrote
 * is not news to you, and one edited last year still is if you never saw it.
 *
 * Returns the notification ids per page, not just a flag, so that opening
 * the page can mark exactly those rows read and clear its dot.
 */
export async function getUnreadWikiPages(input: {
  entitySlug: string;
  subject: string;
}): Promise<Record<string, string[]>> {
  const collection = await getCollection<InAppNotificationDocument>(
    NOTIFICATION_COLLECTION,
  );
  const rows = await collection
    .find({
      $and: [
        // The reader's own audience, as everywhere else: the tree must not
        // become a way to learn that a page exists from someone else's mail.
        await notificationAudienceQuery(input.subject),
        { entity_slug: input.entitySlug },
        { read_by_subjects: { $ne: input.subject } },
        { dismissed_by_subjects: { $ne: input.subject } },
      ],
    } as never)
    .project<Pick<InAppNotificationDocument, "_id" | "href">>({ _id: 1, href: 1 })
    .toArray();

  const byPage: Record<string, string[]> = {};
  for (const row of rows) {
    // Most of an entity's notifications are not about a page at all. The
    // link is what says otherwise, so anything that does not decode to a
    // page path is simply not this tree's business.
    const path = row.href ? wikiPagePathFromHref(row.href) : null;
    if (!path) continue;
    (byPage[path] ??= []).push(row._id);
  }
  return byPage;
}
