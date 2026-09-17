import { parseFrontmatter } from "@/lib/tome/schema";

export interface StandupSections {
  whatIsThis: string;
  headline: string;
  progress: string;
  blockers: string;
  upNext: string;
  fallback: string;
}

const MIN_HEADLINE_SENTENCE_LENGTH = 20;
const MAX_HEADLINE_LENGTH = 120;

export function plainStandupHeadline(headline: string): string {
  return headline
    .replace(/^#{1,6}\s+/, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Legacy standups sometimes put an entire report into `## Headline`. Keep the
 * report intact in storage while presenting only its first meaningful
 * sentence. New reports already follow the one-sentence contract.
 */
export function summarizeStandupHeadline(headline: string): string {
  const normalized = plainStandupHeadline(headline);
  if (!normalized) return "";

  const sentenceEnds = normalized.matchAll(
    /[.!?](?=\s+[A-Z0-9]|\s*$)/g,
  );
  for (const match of sentenceEnds) {
    const end = (match.index ?? 0) + match[0].length;
    if (end >= MIN_HEADLINE_SENTENCE_LENGTH) {
      return normalized.slice(0, end);
    }
  }

  if (normalized.length <= MAX_HEADLINE_LENGTH) return normalized;
  const wordBoundary = normalized.lastIndexOf(" ", MAX_HEADLINE_LENGTH);
  const end = wordBoundary >= MIN_HEADLINE_SENTENCE_LENGTH
    ? wordBoundary
    : MAX_HEADLINE_LENGTH;
  return `${normalized.slice(0, end).replace(/[,:;—-]+$/, "")}…`;
}

type StandupSectionKey =
  | "whatIsThis"
  | "headline"
  | "progress"
  | "blockers"
  | "upNext";

const SECTION_ALIASES: Record<string, StandupSectionKey> = {
  "what is this": "whatIsThis",
  headline: "headline",
  progress: "progress",
  "since last update": "progress",
  "what changed": "progress",
  accomplishments: "progress",
  completed: "progress",
  "asks / blockers": "blockers",
  "asks/blockers": "blockers",
  blockers: "blockers",
  "up next": "upNext",
};

function sectionKey(label: string): StandupSectionKey | undefined {
  const normalized = label
    .replace(/\([^)]*\)\s*$/, "")
    .replace(/:$/, "")
    .trim()
    .toLowerCase();
  return SECTION_ALIASES[normalized];
}

export function parseStandup(markdown: string): StandupSections {
  const [, body] = parseFrontmatter(markdown);
  const normalizedBody = body.replace(
    /\*\*\s*(what is this|headline|progress|since last update|what changed|accomplishments|completed|asks\s*\/?\s*blockers|blockers|up next)\s*:?\s*\*\*/gi,
    (_match, label: string) => `\n## ${label}\n`,
  );
  const sections: Partial<Record<StandupSectionKey, string>> = {};
  const heading = /^#{2,3}\s+(.+?)\s*$/gm;
  const matches = [...normalizedBody.matchAll(heading)];
  for (let index = 0; index < matches.length; index++) {
    const key = sectionKey(matches[index][1]);
    if (!key) continue;
    const start = (matches[index].index ?? 0) + matches[index][0].length;
    const end =
      index + 1 < matches.length
        ? matches[index + 1].index ?? normalizedBody.length
        : normalizedBody.length;
    sections[key] = normalizedBody.slice(start, end).trim();
  }
  const structured = Boolean(
    sections.whatIsThis ||
      sections.headline ||
      sections.progress ||
      sections.blockers ||
      sections.upNext,
  );
  return {
    whatIsThis: sections.whatIsThis ?? "",
    headline: sections.headline ?? "",
    progress: sections.progress ?? "",
    blockers: sections.blockers ?? "",
    upNext: sections.upNext ?? "",
    fallback: structured ? "" : body.trim(),
  };
}
