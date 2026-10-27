import { isReferencePath, splitWikiTree } from "@/lib/tome/wiki-tree-split";
import type { PageTreeNode } from "@/types/tome";

function node(path: string, children: PageTreeNode[] = []): PageTreeNode {
  return {
    path,
    title: path.split("/").pop() ?? path,
    kind: children.length > 0 ? "folder" : "page",
    order: 0,
    children,
  };
}

describe("splitWikiTree", () => {
  it("sends mirrored sources to references and keeps the rest", () => {
    const { authored, reference } = splitWikiTree([
      node("charter"),
      node("repos", [node("repos/example-service")]),
      node("decisions", [node("decisions/0001-pick-a-queue")]),
      node("confluence", [node("confluence/handbook")]),
      node("glossary"),
    ]);
    expect(authored.map((n) => n.path)).toEqual(["charter", "decisions"]);
    expect(reference.map((n) => n.path)).toEqual(["repos", "confluence", "glossary"]);
  });

  it("keeps a reference root's own children under it", () => {
    const { reference } = splitWikiTree([node("repos", [node("repos/a"), node("repos/b")])]);
    expect(reference[0]?.children.map((n) => n.path)).toEqual(["repos/a", "repos/b"]);
  });

  it("does not move a page that merely mentions a root", () => {
    const { authored, reference } = splitWikiTree([
      node("repository-conventions"),
      node("notes/webex-retro"),
    ]);
    expect(authored.map((n) => n.path)).toEqual([
      "repository-conventions",
      "notes/webex-retro",
    ]);
    expect(reference).toEqual([]);
  });

  it("returns two empty lists for an empty wiki", () => {
    expect(splitWikiTree([])).toEqual({ authored: [], reference: [] });
  });

  it("leaves the source list untouched", () => {
    const tree = [node("charter"), node("repos")];
    splitWikiTree(tree);
    expect(tree.map((n) => n.path)).toEqual(["charter", "repos"]);
  });
});

describe("isReferencePath", () => {
  it("judges a page by the root it sits under", () => {
    expect(isReferencePath("repos/example-service/readme")).toBe(true);
    expect(isReferencePath("glossary")).toBe(true);
    expect(isReferencePath("charter")).toBe(false);
    // An agent drafted it, but the decision it records is the team's.
    expect(isReferencePath("decisions/0001-pick-a-queue")).toBe(false);
    expect(isReferencePath("")).toBe(false);
  });
});
