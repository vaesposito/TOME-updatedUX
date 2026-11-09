import { TOME_SOURCES, groupBySource, sourceById } from "@/lib/tome/sources";
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

/** The entry for one system, by id. */
function entry(groups: ReturnType<typeof groupBySource>, id: string) {
  return groups.find((group) => group.source.id === id)!;
}

describe("sources", () => {
  it("names the systems a space reads from", () => {
    expect(TOME_SOURCES.map((source) => source.id)).toEqual([
      "github",
      "jira",
      "confluence",
      "sharepoint",
      "webex",
    ]);
  });

  it("marks the ones nothing in this build talks to", () => {
    expect(sourceById("jira")?.unavailable).toBe(true);
    expect(sourceById("github")?.unavailable).toBeUndefined();
    expect(sourceById("bitbucket")).toBeUndefined();
  });

  it("sorts the mirrored tree into the system each page came from", () => {
    const groups = groupBySource([
      node("repos", [node("repos/example-service"), node("repos/example-ui")]),
      node("confluence", [node("confluence/handbook")]),
    ]);

    expect(entry(groups, "github").nodes.map((n) => n.path)).toEqual([
      "repos/example-service",
      "repos/example-ui",
    ]);
    expect(entry(groups, "confluence").nodes.map((n) => n.path)).toEqual([
      "confluence/handbook",
    ]);
  });

  it("lifts what is inside a root rather than repeating the root itself", () => {
    const groups = groupBySource([node("repos", [node("repos/example-service")])]);

    // The folder named `repos` is GitHub saying its own name twice.
    expect(entry(groups, "github").nodes.map((n) => n.path)).toEqual([
      "repos/example-service",
    ]);
  });

  it("counts the pages, however deep the folders holding them go", () => {
    const groups = groupBySource([
      node("repos", [
        node("repos/example-service", [
          node("repos/example-service/readme.md"),
          node("repos/example-service/docs", [
            node("repos/example-service/docs/api.md"),
          ]),
        ]),
      ]),
    ]);

    expect(entry(groups, "github").count).toBe(2);
  });

  it("returns every system, including the ones holding nothing", () => {
    const groups = groupBySource([]);

    expect(groups).toHaveLength(TOME_SOURCES.length);
    // A system that is connected and empty and one that was never connected
    // read identically as a count, and the reader's next move differs
    // completely between them.
    expect(entry(groups, "confluence").count).toBe(0);
    expect(entry(groups, "jira").source.unavailable).toBe(true);
  });

  it("gives a system with no mirror of its own nothing to show", () => {
    const groups = groupBySource([node("repos", [node("repos/a")])]);

    expect(entry(groups, "jira").nodes).toEqual([]);
    expect(entry(groups, "jira").count).toBe(0);
  });

  it("ignores a root merely named after a system", () => {
    const groups = groupBySource([node("repository-conventions")]);

    expect(entry(groups, "github").nodes).toEqual([]);
  });
});
