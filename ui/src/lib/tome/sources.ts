/**
 * The systems a space reads from, as the navigation groups them.
 *
 * A space's material arrives from somewhere — a repository, a Confluence
 * space, a SharePoint site — and until now the navigation showed the arrival
 * rather than the arrival's source: one flat list of mirrored folders, with
 * GitHub's issues somewhere else entirely. Grouping by the system that owns
 * the material lets a reader ask "what do we have from Confluence?" and
 * answer it in one place, and puts the issues where their repositories are.
 *
 * Pure: a list of systems and a way to sort pages into them.
 */

import type { PageTreeNode } from "@/types/tome";

export type SourceId = "github" | "jira" | "confluence" | "sharepoint" | "webex";

export interface TomeSource {
  id: SourceId;
  name: string;
  /** Which brand mark stands for it. */
  provider: string;
  /**
   * The wiki root its mirrored pages land under.
   *
   * Absent where a system holds no pages of its own: Jira's tickets would
   * live in Jira, as GitHub's issues do, rather than being copied in.
   */
  root?: string;
  /** One line on what this system contributes, for the rail's hover note. */
  blurb: string;
  /** True while nothing in this build talks to it. */
  unavailable?: boolean;
}

export const TOME_SOURCES: readonly TomeSource[] = [
  {
    id: "github",
    name: "GitHub",
    provider: "github",
    root: "repos",
    blurb:
      "The repositories this space watches: their files as mirrored pages, and the issues raised against them.",
  },
  {
    id: "jira",
    name: "Jira",
    provider: "atlassian",
    blurb: "Tickets raised against this space's work.",
    unavailable: true,
  },
  {
    id: "confluence",
    name: "Confluence",
    provider: "atlassian",
    root: "confluence",
    blurb: "Spaces mirrored page by page, read here and edited there.",
  },
  {
    id: "sharepoint",
    name: "SharePoint",
    provider: "sharepoint",
    root: "sharepoint",
    blurb: "Documents and sites mirrored into this space.",
  },
  {
    id: "webex",
    name: "Webex",
    provider: "webex",
    root: "webex",
    blurb:
      "Rooms this space reads, written up page by page. The calls themselves are under Meetings.",
  },
] as const;

export function sourceById(id: string): TomeSource | undefined {
  return TOME_SOURCES.find((source) => source.id === id);
}

/** A system and the mirrored pages that arrived from it. */
export interface SourceWithPages {
  source: TomeSource;
  nodes: PageTreeNode[];
  /** How much arrived, counting the pages rather than the folders holding them. */
  count: number;
}

/** The pages under one root, counted as pages however deep the folders go. */
function pagesIn(nodes: readonly PageTreeNode[]): number {
  return nodes.reduce(
    (total, node) =>
      total + (node.kind === "folder" ? pagesIn(node.children) : 1),
    0,
  );
}

/**
 * Sort the mirrored tree into the systems it came from.
 *
 * Every system is returned, including the ones holding nothing: a source
 * that is connected and empty and a source that was never connected read
 * identically once the list is only what was found, and the reader's next
 * move differs completely between the two.
 */
export function groupBySource(
  reference: readonly PageTreeNode[],
): SourceWithPages[] {
  return TOME_SOURCES.map((source) => {
    const nodes = source.root
      ? reference.filter((node) => (node.path.split("/")[0] ?? "") === source.root)
      : [];
    // A root folder is the system's own name repeated; what a reader counts
    // is what is inside it.
    const held = nodes.flatMap((node) =>
      node.kind === "folder" ? node.children : [node],
    );
    return { source, nodes: held, count: pagesIn(held) };
  });
}
