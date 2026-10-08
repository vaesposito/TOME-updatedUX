import {
  MAX_CONFLUENCE_SOURCES_PER_PROJECT,
  decodeConfluenceSource,
  encodeConfluenceSource,
  isConfluencePageUrl,
  normalizeConfluencePageScope,
  normalizeConfluencePageScopes,
  normalizeConfluenceSpaces,
  parseConfluenceUrl,
  toConfluenceSpaceSource,
} from "../confluence-source";

describe("parseConfluenceUrl", () => {
  it("parses a space URL", () => {
    expect(
      parseConfluenceUrl("https://example.atlassian.net/wiki/spaces/PLATFORM"),
    ).toEqual({
      url: "https://example.atlassian.net/wiki/spaces/PLATFORM",
      base_url: "https://example.atlassian.net",
      space_key: "PLATFORM",
      page_id: undefined,
    });
  });

  it("parses a modern page URL", () => {
    expect(
      parseConfluenceUrl(
        "https://example.atlassian.net/wiki/spaces/PLATFORM/pages/12345/Overview",
      ),
    ).toMatchObject({
      base_url: "https://example.atlassian.net",
      space_key: "PLATFORM",
      page_id: "12345",
    });
  });

  it.each([
    "https://example.atlassian.net/wiki/pages/12345",
    "https://example.atlassian.net/wiki/pages/viewpage.action?pageId=12345",
  ])("parses page id from %s", (url) => {
    expect(parseConfluenceUrl(url)?.page_id).toBe("12345");
    expect(isConfluencePageUrl(url)).toBe(true);
  });

  it("rejects invalid input", () => {
    expect(parseConfluenceUrl("not a url")).toBeNull();
  });
});

describe("normalizeConfluencePageScope", () => {
  it("normalizes a valid scope", () => {
    expect(
      normalizeConfluencePageScope({
        page_id: " 123 ",
        page_title: " Overview ",
        space_key: " PLATFORM ",
        include_descendants: false,
      }),
    ).toEqual({
      page_id: "123",
      page_title: "Overview",
      space_key: "PLATFORM",
      include_descendants: false,
    });
  });

  it("rejects a scope without a numeric page id", () => {
    expect(
      normalizeConfluencePageScope({
        page_id: "overview",
        page_title: "Overview",
        space_key: "PLATFORM",
      }),
    ).toBeUndefined();
  });
});

describe("normalizeConfluencePageScopes", () => {
  it("normalizes and deduplicates page roots", () => {
    expect(
      normalizeConfluencePageScopes([
        {
          page_id: " 123 ",
          page_title: " Overview ",
          space_key: " PLATFORM ",
        },
        {
          page_id: "123",
          page_title: "Duplicate",
          space_key: "PLATFORM",
        },
        {
          page_id: "invalid",
          page_title: "Ignored",
          space_key: "PLATFORM",
        },
      ]),
    ).toEqual([
      {
        page_id: "123",
        page_title: "Overview",
        space_key: "PLATFORM",
        include_descendants: true,
      },
    ]);
  });
});

describe("encodeConfluenceSource / decodeConfluenceSource", () => {
  it("round-trips a space entry", () => {
    const encoded = encodeConfluenceSource({
      url: "https://example.atlassian.net/wiki/spaces/PLATFORM",
      base_url: "https://example.atlassian.net",
      space_key: "PLATFORM",
      name: "Platform",
      page_scopes: [
        {
          page_id: "123",
          page_title: "Overview",
          space_key: "PLATFORM",
          include_descendants: true,
        },
      ],
    });
    expect(decodeConfluenceSource(encoded)).toEqual({
      url: "https://example.atlassian.net/wiki/spaces/PLATFORM",
      base_url: "https://example.atlassian.net",
      space_key: "PLATFORM",
      name: "Platform",
      page_scopes: [
        {
          page_id: "123",
          page_title: "Overview",
          space_key: "PLATFORM",
          include_descendants: true,
        },
      ],
    });
  });

  it("tolerates a bare URL (legacy/manual entry)", () => {
    const decoded = decodeConfluenceSource(
      "https://example.atlassian.net/wiki/spaces/PLATFORM",
    );
    expect(decoded).toEqual({
      url: "https://example.atlassian.net/wiki/spaces/PLATFORM",
      base_url: "https://example.atlassian.net",
      space_key: "PLATFORM",
      name: "PLATFORM",
      page_scopes: [],
    });
  });
});

describe("toConfluenceSpaceSource", () => {
  it("derives a slug from the space key", () => {
    expect(
      toConfluenceSpaceSource(
        encodeConfluenceSource({
          url: "https://example.atlassian.net/wiki/spaces/My Space",
          base_url: "https://example.atlassian.net",
          space_key: "My Space",
          name: "My Space",
        }),
      ),
    ).toMatchObject({ slug: "my-space", space_key: "My Space" });
  });
});

describe("normalizeConfluenceSpaces", () => {
  const space = (spaceKey: string, baseUrl = "https://example.atlassian.net") => ({
    name: spaceKey,
    space_key: spaceKey,
    base_url: baseUrl,
  });

  it("bounds the result to the configured cap", () => {
    const spaces = Array.from({ length: MAX_CONFLUENCE_SOURCES_PER_PROJECT + 3 }, (_, i) =>
      space(`SPACE${i}`),
    );
    expect(normalizeConfluenceSpaces(spaces)).toHaveLength(
      MAX_CONFLUENCE_SOURCES_PER_PROJECT,
    );
  });

  it("dedupes by base_url + space_key", () => {
    const result = normalizeConfluenceSpaces([
      space("PLATFORM"),
      space("PLATFORM"),
      space("PLATFORM", "https://other.atlassian.net"),
    ]);
    expect(result).toHaveLength(2);
  });

  it("disambiguates slug collisions across different spaces", () => {
    const result = normalizeConfluenceSpaces([
      space("Platform Docs"),
      space("Platform  Docs!"), // slugifies to the same value as above
    ]);
    expect(result.map((s) => s.slug)).toEqual(["platform-docs", "platform-docs-2"]);
  });

  it("drops entries without a space key", () => {
    expect(normalizeConfluenceSpaces([{ name: "No key" }])).toEqual([]);
  });

  it("returns an empty array for non-array input", () => {
    expect(normalizeConfluenceSpaces(undefined)).toEqual([]);
  });
});
