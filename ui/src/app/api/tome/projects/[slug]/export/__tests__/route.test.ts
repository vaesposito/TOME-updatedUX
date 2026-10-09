/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockListPages = jest.fn();
const mockFindGist = jest.fn();

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
}));
jest.mock("@/lib/tome/page-store", () => ({
  getPageStore: jest.fn().mockImplementation(async () => ({
    listPages: (...args: unknown[]) => mockListPages(...args),
  })),
}));
jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeGistsCollection: jest.fn().mockImplementation(async () => ({
    findOne: (...args: unknown[]) => mockFindGist(...args),
  })),
}));
jest.mock("@/lib/tome/folder-store", () => ({
  ensureFoldersForPages: jest.fn(),
  listFolders: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/tome/navigation-store", () => ({
  ensurePagePlacements: jest.fn(),
  listPagePlacements: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/tome/presentation-pptx", () => ({
  presentationFilename: (slug: string, title: string) => `${slug}-${title.toLowerCase().replace(/\s+/g, "-")}.pptx`,
  renderPresentationPptx: jest.fn().mockResolvedValue(new Uint8Array([80, 75, 3, 4])),
}));

import { GET } from "@/app/api/tome/projects/[slug]/export/route";

const context = { params: Promise.resolve({ slug: "example-project" }) };

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadTomeProject.mockResolvedValue({
    projectId: "project-1",
    project: { title: "Example Project" },
    user: { email: "test-user@example.com" },
  });
  mockListPages.mockResolvedValue({
    "overview.md": `---
title: Overview
kind: stable
---
# Summary

Visible. <!-- hidden guidance -->`,
  });
  mockFindGist.mockResolvedValue(null);
});

describe("GET Tome wiki export", () => {
  it("downloads sanitized Markdown", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/export?format=markdown",
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="example-project-wiki.md"',
    );
    const body = await response.text();
    expect(body).toContain("# Example Project");
    expect(body).toContain("Visible.");
    expect(body).not.toContain("hidden guidance");
  });

  it("exports only the requested page", async () => {
    mockListPages.mockResolvedValue({
      "overview.md": `---\ntitle: Overview\nkind: stable\n---\nOverview content.`,
      "roadmap.md": `---\ntitle: Roadmap\nkind: dynamic\n---\nRoadmap content.`,
    });

    const response = await GET(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/export?format=markdown&path=roadmap.md",
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="roadmap.md"',
    );
    const body = await response.text();
    expect(body).toBe("# Roadmap\n\nRoadmap content.\n");
    expect(body).not.toContain("Contents");
    expect(body).not.toContain("roadmap.md");
    expect(body).not.toContain("dynamic");
    expect(body).not.toContain("Overview content.");
  });

  it("names a nested page's download after its title, not its folder or file name", async () => {
    mockListPages.mockResolvedValue({
      "guides/setup.md": `---\ntitle: Getting Started\nkind: stable\n---\nSetup content.`,
    });

    const response = await GET(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/export?format=markdown&path=guides/setup.md",
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="getting-started.md"',
    );
  });

  it("returns a real PDF with a PDF filename", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/export?format=pdf&path=overview.md",
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="overview.pdf"',
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(Number(response.headers.get("Content-Length"))).toBe(bytes.byteLength);
  });

  it("downloads a source-grounded Outshift PowerPoint for a wiki", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/export?format=pptx",
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("presentationml.presentation");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="example-project-example-project.pptx"',
    );
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("downloads a project-authorized gist with its own filename", async () => {
    mockFindGist.mockResolvedValue({
      _id: "gist-1",
      project_id: "project-1",
      title: "Example notes",
      filename: "example-notes.md",
      body: "# Notes\n\nVisible. <!-- hidden guidance -->",
    });

    const response = await GET(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/export?format=markdown&gist=gist-1",
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="example-notes.md"',
    );
    expect(await response.text()).toBe("# Notes\n\nVisible.\n");
    expect(mockFindGist).toHaveBeenCalledWith({ _id: "gist-1", project_id: "project-1" });
    expect(mockListPages).not.toHaveBeenCalled();
  });

  it("downloads a source-grounded Outshift PowerPoint for a gist", async () => {
    mockFindGist.mockResolvedValue({
      _id: "gist-1",
      project_id: "project-1",
      title: "Example notes",
      filename: "example-notes.md",
      body: "# Notes\n\n- A source-backed note",
    });

    const response = await GET(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/export?format=pptx&gist=gist-1",
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("presentationml.presentation");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="example-project-example-notes.pptx"',
    );
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 2).toString("ascii")).toBe("PK");
    expect(mockListPages).not.toHaveBeenCalled();
  });

  it("returns not found when a gist is outside the project", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/export?format=pdf&gist=other-gist",
      ),
      context,
    );

    expect(response.status).toBe(404);
    expect(mockFindGist).toHaveBeenCalledWith({
      _id: "other-gist",
      project_id: "project-1",
    });
  });

  it("returns not found for an unknown page", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/export?format=pdf&path=missing.md",
      ),
      context,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        success: false,
        error: "Page not found",
      }),
    );
  });

  it("rejects unsupported formats", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/export?format=docx",
      ),
      context,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        success: false,
        error: "Supported export formats: pdf, html, markdown, pptx",
      }),
    );
  });
});
