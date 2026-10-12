/**
 * Whether a notification is important, taken from the artifact it is about.
 *
 * Nothing is parsed here that TOME did not already parse: `priorityFromLabels`
 * is the same function the issue views use, and the suffixes are TOME's own
 * `critical` / `needs attention` labels. The point is that a notification no
 * longer decides its own urgency — the artifact does, so a page marked
 * critical reads as important everywhere it is mentioned.
 *
 * Importance is a yes or no. TOME grades artifacts finely, but a reader
 * scanning an inbox is only ever asking whether a row can wait, and offering
 * four levels of "sort of" would not help them answer it.
 */

import { priorityFromLabels } from "@/lib/github-issue-snapshot";
import { DEFAULT_TOME_ISSUE_LABEL_SETTINGS } from "@/lib/tome/issue-filter-views";
import { parseFrontmatter } from "@/lib/tome/schema";

const URGENT_SUFFIXES = [
  DEFAULT_TOME_ISSUE_LABEL_SETTINGS.labels.critical.suffix,
  DEFAULT_TOME_ISSUE_LABEL_SETTINGS.labels["needs-attention"].suffix,
];

/**
 * Whether an artifact's labels mark it as important.
 *
 * `critical` and `high` qualify; medium and low are real priorities but not
 * calls to act. `decision` is deliberately excluded — it says what an item
 * is, not how urgent it is, and counting it would make every open question
 * shout.
 */
export function artifactIsImportant(labels: readonly string[] | undefined): boolean {
  if (!labels?.length) return false;

  const priority = priorityFromLabels([...labels]);
  if (priority === "critical" || priority === "high") return true;

  // Accepts a bare suffix or the `tome:`-prefixed form the trackers write.
  return labels.some((label) => {
    const normalized = label.trim().toLowerCase();
    return URGENT_SUFFIXES.some(
      (suffix) => normalized === suffix || normalized === `tome:${suffix}`,
    );
  });
}

/**
 * Whether a wiki page marks itself important, read from its own frontmatter.
 *
 * Both keys are accepted because a page may already say `priority: critical`
 * in prose-facing frontmatter while a tracker-fed page carries a `labels`
 * list; they go through the same parser either way.
 */
export function pageIsImportant(markdown: string): boolean {
  const [frontmatter] = parseFrontmatter(markdown);
  const labels = [frontmatter.labels, frontmatter.priority]
    .flatMap((value) =>
      Array.isArray(value) ? value : typeof value === "string" ? [value] : [],
    )
    .filter((label) => label.trim() !== "");
  return artifactIsImportant(labels);
}
