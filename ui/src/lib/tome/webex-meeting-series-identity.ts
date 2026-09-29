import type { WebexMeetingSeriesSourceRefs } from "@/types/projects";

export interface MeetingSeriesIdentity {
  seriesKey: string;
  sourceRefs?: WebexMeetingSeriesSourceRefs;
  title?: string;
  hostEmail?: string;
}

/** Preserve join identifiers (including MTID) and case-sensitive URL values. */
export function normalizedSeriesWebLink(value: string | undefined): string {
  if (!value?.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    url.searchParams.sort();
    return url.toString();
  } catch {
    return "";
  }
}

export function conflictingSeriesIds(
  left: WebexMeetingSeriesSourceRefs,
  right: WebexMeetingSeriesSourceRefs,
): boolean {
  return (["meetingSeriesId", "userHubSeriesId"] as const).some(
    (key) => Boolean(left[key] && right[key] && left[key] !== right[key]),
  );
}

function meetingLinkId(link: string | undefined): string {
  try {
    const url = new URL(link ?? "");
    for (const [key, value] of url.searchParams) {
      if (key.toLowerCase() === "mtid") return value;
    }
  } catch { /* Missing/invalid links cannot supply identity evidence. */ }
  return "";
}

/** Weak title-based joins must not assume that different join links are aliases. */
export function compatibleSeriesMetadata(left: MeetingSeriesIdentity, right: MeetingSeriesIdentity): boolean {
  const title = left.title?.trim().toLowerCase();
  if (!title || title !== right.title?.trim().toLowerCase()) return false;
  const leftHost = left.hostEmail?.trim().toLowerCase();
  const rightHost = right.hostEmail?.trim().toLowerCase();
  if (leftHost && rightHost && leftHost !== rightHost) return false;
  const leftRefs = left.sourceRefs ?? {};
  const rightRefs = right.sourceRefs ?? {};
  if (conflictingSeriesIds(leftRefs, rightRefs)) return false;
  if (leftRefs.meetingNumber && rightRefs.meetingNumber && leftRefs.meetingNumber !== rightRefs.meetingNumber) return false;
  const leftLinkId = meetingLinkId(leftRefs.webLink);
  const rightLinkId = meetingLinkId(rightRefs.webLink);
  // Different MTIDs need verification, not automatic merging or a claim that
  // the meetings differ. Discovery resolves possible aliases to public IDs.
  return !(leftLinkId && rightLinkId && leftLinkId !== rightLinkId);
}

function matchStrength(left: MeetingSeriesIdentity, right: MeetingSeriesIdentity): number {
  const a = left.sourceRefs ?? {};
  const b = right.sourceRefs ?? {};
  if (conflictingSeriesIds(a, b)) return 0;
  // Legacy URL-only keys are room addresses, not durable series identities.
  if (left.seriesKey && left.seriesKey === right.seriesKey && !/^userhub:https?:/i.test(left.seriesKey)) return 3;
  if ((a.meetingSeriesId && a.meetingSeriesId === b.meetingSeriesId) ||
      (a.userHubSeriesId && a.userHubSeriesId === b.userHubSeriesId)) return 3;
  if (a.scheduledMeetingId && a.scheduledMeetingId === b.scheduledMeetingId) return 2;
  if (!compatibleSeriesMetadata(left, right)) return 0;
  const link = normalizedSeriesWebLink(a.webLink);
  const matchingWeakRef = (a.meetingNumber && a.meetingNumber === b.meetingNumber) ||
    (link && link === normalizedSeriesWebLink(b.webLink));
  return matchingWeakRef ? 1 : 0;
}

export function meetingSeriesMatches(left: MeetingSeriesIdentity, right: MeetingSeriesIdentity): boolean {
  return matchStrength(left, right) > 0;
}

/** Prefer durable identity over weak cross-source evidence; never choose a tie. */
export function findMatchingMeetingSeries<T extends MeetingSeriesIdentity>(
  candidates: readonly T[],
  stored: MeetingSeriesIdentity,
): T | undefined {
  let strongest = 0;
  let match: T | undefined;
  let ambiguous = false;
  for (const candidate of candidates) {
    const strength = matchStrength(candidate, stored);
    if (strength > strongest) {
      strongest = strength;
      match = candidate;
      ambiguous = false;
    } else if (strength > 0 && strength === strongest) {
      ambiguous = true;
    }
  }
  return ambiguous ? undefined : match;
}
