/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

const mockGetCollection = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

const RAW_BASE = "https://raw.githubusercontent.com/caipe-io/ai-platform-engineering/main/docs/releases";

const LISTING = [
  { name: "README.md", type: "file", download_url: `${RAW_BASE}/README.md` },
  { name: "2026-05-26-release-0-5-0.md", type: "file", download_url: `${RAW_BASE}/2026-05-26-release-0-5-0.md` },
  { name: "2026-06-01-release-0-6-0.md", type: "file", download_url: `${RAW_BASE}/2026-06-01-release-0-6-0.md` },
  { name: "subdir", type: "dir", download_url: null },
];

const BODY_050 = `---
slug: release-0.5.0
title: "Release 0.5.0 — Admin UI Polish"
date: 2026-05-26
---

> Released: 2026-05-26

## Highlights

A small maintenance release.

<!-- truncate -->

## What's New

- **Admin UI**: shared pickers

## Upgrade Guide: 0.4.0 → 0.5.0

Run the migration runbook before applying schema changes.
`;

const BODY_060 = `---
title: "Release 0.6.0 — Big Stuff"
date: 2026-06-01
---

## Highlights

Newest available notes.
`;

function mockGithub() {
  global.fetch = jest.fn(async (url: string | URL) => {
    const u = String(url);
    let hostname = "";
    try {
      hostname = new URL(u).hostname;
    } catch {
      hostname = "";
    }
    if (hostname === "api.github.com") {
      return { ok: true, json: async () => LISTING } as unknown as Response;
    }
    if (u.endsWith("0-5-0.md")) {
      return { ok: true, text: async () => BODY_050 } as unknown as Response;
    }
    if (u.endsWith("0-6-0.md")) {
      return { ok: true, text: async () => BODY_060 } as unknown as Response;
    }
    return { ok: false, status: 404, text: async () => "", json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
}

async function callGet(version: string) {
  jest.resetModules();
  mockGithub();
  const { GET } = await import("../route");
  const res = await GET(new NextRequest(`http://localhost/api/release-notes?version=${version}`));
  return res.json();
}

describe("/api/release-notes", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.RELEASE_NOTES_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  });

  it("returns the series notes with frontmatter and truncate marker stripped", async () => {
    const data = await callGet("0.5.0");
    expect(data.matchedVersion).toBe("0.5.0");
    expect(data.title).toBe("Release 0.5.0 — Admin UI Polish");
    // Frontmatter is removed.
    expect(data.body).not.toContain("slug: release-0.5.0");
    // Docusaurus truncate marker is removed.
    expect(data.body).not.toContain("<!-- truncate -->");
    // Real markdown content is preserved.
    expect(data.body).toContain("## What's New");
    expect(data.body).toContain("Run the migration runbook");
  });

  it("resolves a patch version to its minor series post", async () => {
    const data = await callGet("0.5.42");
    expect(data.matchedVersion).toBe("0.5.0");
    expect(data.title).toBe("Release 0.5.0 — Admin UI Polish");
  });

  it("resolves a prerelease to its own series post", async () => {
    const data = await callGet("0.6.1-dev.14");
    expect(data.matchedVersion).toBe("0.6.0");
    expect(data.title).toBe("Release 0.6.0 — Big Stuff");
  });

  it("does not fall back to an older series when the requested series has no post", async () => {
    const data = await callGet("1.0.0-rc.1");
    expect(data.matchedVersion).toBeNull();
    expect(data.body).toBeNull();
    expect(data.source).toBe("none");
  });

  it("returns 400 when no version is provided", async () => {
    jest.resetModules();
    mockGithub();
    const { GET } = await import("../route");
    const res = await GET(new NextRequest("http://localhost/api/release-notes"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.body).toBeNull();
  });

  it("builds release notes from configured full SHAs and Git tag refs", async () => {
    jest.resetModules();
    process.env.RELEASE_NOTES_GITHUB_TOKEN = "test-token";
    const previousSha = "a".repeat(64);
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({
        _id: "platform_settings",
        release_notes: {
          repository_url: "https://github.com/example/repository",
          previous_commit: previousSha,
          latest_commit: "release/1.1",
        },
      }),
    });
    global.fetch = jest.fn(async (_url: string | URL, init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        commits: [
          {
            sha: "b".repeat(40),
            commit: {
              message: "feat(ui): add tag-based release notes (#42)",
              committer: { date: "2026-09-14T12:00:00Z" },
            },
          },
        ],
      }),
      headers: init?.headers,
    })) as unknown as typeof fetch;

    const { GET } = await import("../route");
    const response = await GET(
      new NextRequest("http://localhost/api/release-notes?version=1.0.0&compare=platform"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      requestedVersion: "1.0.0",
      matchedVersion: "1.0.0",
      source: "github-compare",
      date: "2026-09-14",
    });
    expect(data.body).toContain("tag-based release notes");
    expect(data.changelogUrl).toBe(
      "https://github.com/example/repository/compare/" +
        encodeURIComponent(previousSha) +
        "...release%2F1.1",
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/repos/example/repository/compare/" +
          encodeURIComponent(previousSha) +
          "...release%2F1.1",
      ),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );
  });
});
