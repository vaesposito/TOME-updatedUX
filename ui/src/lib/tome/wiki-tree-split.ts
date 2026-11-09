/**
 * Dividing a wiki's page tree into what the team writes and what it reads.
 *
 * One tree holds two unlike things. A charter, a roadmap and a standup are
 * the space's own account of itself, written to be edited. A mirrored
 * Confluence space, a repository's files and a glossary built from them are
 * source material: read often, edited never, and large enough to bury the
 * eight pages anyone actually came for.
 *
 * The new navigation shows them as two destinations rather than one tree with
 * nine collapsed folders at the bottom of it. Nothing is hidden or moved on
 * the server — the split is a reading of the same tree, by root folder.
 */

import type { PageTreeNode } from "@/types/tome";

/**
 * Root folders holding material this space mirrors rather than authors.
 *
 * Deliberately the same set the sidebar already collapses on sight and gives
 * provider brand marks to, minus the agent's own working folders — a decision
 * record is the team's, even when an agent drafted it.
 */
export const REFERENCE_ROOTS: readonly string[] = [
  "repos",
  "confluence",
  "webex",
  "sharepoint",
];

const REFERENCE = new Set(REFERENCE_ROOTS);

/**
 * Where the space keeps its own vocabulary.
 *
 * Neither authored prose nor mirrored material. The terms are written here,
 * mostly by the agent, but they are read as a list of words rather than as
 * pages, so they get a destination of their own instead of a folder in the
 * tree.
 */
export const GLOSSARY_ROOT = "glossary";

/** The first segment of a path, which is the root folder it sits in. */
function rootOf(node: PageTreeNode): string {
  return node.path.split("/")[0] ?? "";
}

export interface WikiTreeSplit {
  /** Pages the team and its agent write: charter, roadmap, standup, decisions. */
  authored: PageTreeNode[];
  /** Material mirrored from a source, read rather than edited. */
  reference: PageTreeNode[];
  /** Term entries, kept out of both so they can be shown as a vocabulary. */
  glossary: PageTreeNode[];
}

/**
 * Split a tree by root folder.
 *
 * Only depth zero is consulted. A page nested under `confluence/` belongs to
 * the reference side by virtue of where it sits, and asking again at every
 * level would let a folder named `glossary` inside the authored pages pull
 * itself across.
 */
export function splitWikiTree(tree: readonly PageTreeNode[]): WikiTreeSplit {
  const authored: PageTreeNode[] = [];
  const reference: PageTreeNode[] = [];
  const glossary: PageTreeNode[] = [];
  for (const node of tree) {
    const root = rootOf(node);
    if (root === GLOSSARY_ROOT) glossary.push(node);
    else if (REFERENCE.has(root)) reference.push(node);
    else authored.push(node);
  }
  return { authored, reference, glossary };
}

/** Whether a path belongs to the reference side, for deciding which tree owns a selection. */
export function isReferencePath(path: string): boolean {
  return REFERENCE.has(path.split("/")[0] ?? "");
}

/** Whether a path is a term entry, for the same reason. */
export function isGlossaryPath(path: string): boolean {
  return (path.split("/")[0] ?? "") === GLOSSARY_ROOT;
}
