import { sourcesFromProject } from "@/components/tome/IngestPanel";

describe("sourcesFromProject", () => {
  it("shows selected SharePoint files and their app-only execution identity", () => {
    expect(sourcesFromProject({ sharepoint_documents: [{ drive_id: "drive-1", item_id: "item-1", name: "Example.pptx" }] })).toEqual([
      { kind: "sharepoint", label: "SharePoint", connectorKey: "sharepoint", items: [{ sourceKey: "drive-1/item-1", label: "Example.pptx", detail: "Runs as: configured SharePoint application" }] },
    ]);
  });
  it("keeps distinct SharePoint files with the same display name independently keyed", () => {
    const rows = sourcesFromProject({ sharepoint_documents: [
      { drive_id: "drive-1", item_id: "item-1", name: "Example.pdf" },
      { drive_id: "drive-2", item_id: "item-1", name: "Example.pdf" },
    ] });
    expect(rows[0].items.map((item) => item.sourceKey)).toEqual(["drive-1/item-1", "drive-2/item-1"]);
  });
  it("shows every selected Confluence root with its exact descendant scope", () => {
    const rows = sourcesFromProject({
      confluence_url: "https://example.atlassian.net/wiki/spaces/ENG",
      confluence_page_scopes: [
        {
          page_id: "123",
          page_title: "Architecture",
          space_key: "ENG",
          include_descendants: true,
        },
        {
          page_id: "456",
          page_title: "Release checklist",
          space_key: "ENG",
          include_descendants: false,
        },
      ],
    });

    expect(rows).toEqual([
      {
        kind: "confluence",
        label: "Confluence",
        connectorKey: "atlassian",
        items: [
          {
            label: "Architecture",
            detail: "Space ENG · This page and all subpages",
            href: "https://example.atlassian.net/wiki/spaces/ENG/pages/123",
          },
          {
            label: "Release checklist",
            detail: "Space ENG · This page only",
            href: "https://example.atlassian.net/wiki/spaces/ENG/pages/456",
          },
        ],
      },
    ]);
  });

  it("labels a selection without page roots as the entire space", () => {
    const rows = sourcesFromProject({
      confluence_url: "https://example.atlassian.net/wiki/spaces/ENG",
    });

    expect(rows[0]?.items).toEqual([
      {
        label: "Entire ENG space",
        detail: "https://example.atlassian.net/wiki/spaces/ENG",
        href: "https://example.atlassian.net/wiki/spaces/ENG",
      },
    ]);
  });

  it("supports the legacy singular page scope", () => {
    const rows = sourcesFromProject({
      confluence_url: "https://example.atlassian.net/wiki/spaces/ENG",
      confluence_page_scope: {
        page_id: "789",
        page_title: "Operations",
        space_key: "ENG",
        include_descendants: true,
      },
    });

    expect(rows[0]?.items[0]).toEqual({
      label: "Operations",
      detail: "Space ENG · This page and all subpages",
      href: "https://example.atlassian.net/wiki/spaces/ENG/pages/789",
    });
  });

  it("does not mislabel a legacy page URL as an entire-space selection", () => {
    const rows = sourcesFromProject({
      confluence_url:
        "https://example.atlassian.net/wiki/spaces/ENG/pages/987/Legacy-page",
    });

    expect(rows[0]?.items[0]).toEqual({
      label: "Page 987",
      detail: "Space ENG · This page and all subpages",
      href: "https://example.atlassian.net/wiki/spaces/ENG/pages/987/Legacy-page",
    });
  });
});

describe("sourcesFromProject with confluence_spaces", () => {
  const site = "https://example.atlassian.net";

  it("lists every attached space, scoped or whole, under one Confluence row", () => {
    const rows = sourcesFromProject({
      confluence_spaces: [
        {
          slug: "platform",
          name: "Platform",
          space_key: "PLATFORM",
          base_url: site,
          page_scopes: [
            {
              page_id: "123",
              page_title: "Architecture",
              space_key: "PLATFORM",
              include_descendants: true,
            },
          ],
        },
        {
          slug: "marketing",
          name: "Marketing",
          space_key: "MARKETING",
          base_url: site,
        },
      ],
    });

    expect(rows).toEqual([
      {
        kind: "confluence",
        label: "Confluence",
        connectorKey: "atlassian",
        items: [
          {
            label: "Platform: Architecture",
            detail: "Space PLATFORM · This page and all subpages",
            href: `${site}/wiki/spaces/PLATFORM/pages/123`,
          },
          {
            label: "Entire Marketing space",
            detail: `${site}/wiki/spaces/MARKETING`,
            href: `${site}/wiki/spaces/MARKETING`,
          },
        ],
      },
    ]);
  });

  it("prefers confluence_spaces over a legacy confluence_url", () => {
    const rows = sourcesFromProject({
      confluence_url: `${site}/wiki/spaces/LEGACY`,
      confluence_spaces: [
        { slug: "platform", name: "Platform", space_key: "PLATFORM", base_url: site },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.items.map((item) => item.label)).toEqual([
      "Entire Platform space",
    ]);
  });

  it("falls back to the legacy confluence_url when confluence_spaces is empty", () => {
    const rows = sourcesFromProject({
      confluence_url: `${site}/wiki/spaces/ENG`,
      confluence_spaces: [],
    });

    expect(rows[0]?.items[0]).toMatchObject({ label: "Entire ENG space" });
  });
});
