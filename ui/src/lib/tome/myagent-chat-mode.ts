/** First-party chat can select research explicitly or by asking for MyAgent/mail. */
export function requestsMyAgent(message: string): boolean {
  return /\b(?:ask|query|use|talk\s+to|speak\s+to)\s+my\s*agent\b/i.test(message) ||
    /\bmy\s*agent[\s,:-]+(?:get|find|search|check|read|summari[sz]e|show)\b/i.test(message) ||
    /\b(?:get|read|show|check|summari[sz]e|search|find)\b[^?!.]*\b(?:my|recent|latest|unread)\s+(?:e-?mails?|inbox)\b/i.test(message);
}

/** Never resume a private research transcript with general source/write tools. */
export function compatibleChatResume(
  requestedId: string | null, storedId: string | undefined,
  storedResearch: boolean | undefined, requestedResearch: boolean,
): string | null {
  return requestedId && requestedId === storedId && Boolean(storedResearch) === requestedResearch
    ? requestedId : null;
}
