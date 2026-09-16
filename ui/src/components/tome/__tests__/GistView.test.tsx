import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GistView } from "../GistView";

const mockCrepeEditor = jest.fn();
const mockMarkdownRenderer = jest.fn();
let mockUseRealMarkdownRenderer = false;
const mockMermaidRender = jest.fn(async () => ({
  svg: '<svg viewBox="0 0 800 400" aria-roledescription="flowchart-v2"></svg>',
}));

jest.mock("remend", () => ({
  __esModule: true,
  default: (content: string) => content,
}), { virtual: true });

jest.mock("marked-shiki", () => ({
  __esModule: true,
  default: ({ highlight }: { highlight: (code: string, lang: string) => Promise<string> }) => ({
    async: true,
    async walkTokens(token: { type: string; lang?: string; text: string; block?: boolean }) {
      if (token.type !== "code") return;
      token.type = "html";
      token.block = true;
      token.text = `${await highlight(token.text, token.lang ?? "text")}\n`;
    },
  }),
}));

jest.mock("shiki", () => ({
  bundledLanguages: { text: true },
  createHighlighter: jest.fn(async () => ({
    codeToHtml: (code: string) => `<pre><code>${code}</code></pre>`,
    getLoadedLanguages: () => ["text"],
    loadLanguage: jest.fn(),
  })),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => name.toLowerCase() === "content-type" ? "application/json" : null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function htmlResponse(body: string, status: number): Response {
  return {
    ok: false,
    status,
    headers: { get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : null },
    json: async () => {
      throw new SyntaxError("Unexpected token '<'");
    },
    text: async () => body,
  } as Response;
}

jest.mock("@/components/ai-assist", () => ({
  AiAssistButton: () => <button type="button">AI</button>,
}));

jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({
    children,
    className,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
}));

jest.mock("@/components/tome/CrepeEditor", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    CrepeEditor: React.forwardRef(function MockCrepeEditor(
      {
        initialMarkdown,
        onChange,
      }: {
        initialMarkdown: string;
        onChange?: (value: string) => void;
      },
      ref: React.ForwardedRef<{
        getMarkdown: () => string;
        insertMarkdown: (value: string) => void;
        getSelectedText: () => string;
        replaceSelection: (value: string) => void;
      }>,
    ) {
      mockCrepeEditor({ initialMarkdown });
      const [value, setValue] = React.useState(initialMarkdown);
      React.useImperativeHandle(ref, () => ({
        getMarkdown: () => value,
        insertMarkdown: (markdown: string) => {
          setValue((current) => {
            const next = `${current}${markdown}`;
            onChange?.(next);
            return next;
          });
        },
        getSelectedText: () => "",
        captureSelection: () => {},
        restoreSelection: () => {},
        replaceSelection: (markdown: string) => {
          setValue(markdown);
          onChange?.(markdown);
        },
      }), [onChange, value]);
      return (
        <textarea
          aria-label="Gist body"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            onChange?.(event.target.value);
          }}
        />
      );
    }),
  };
});

jest.mock("@/components/shared/timeline/MarkdownRenderer", () => ({
  ...jest.requireActual("@/components/shared/timeline/MarkdownRenderer"),
  MarkdownRenderer: (props: { content: string; enableMermaid?: boolean }) => {
    mockMarkdownRenderer(props);
    if (mockUseRealMarkdownRenderer) {
      const React = jest.requireActual<typeof import("react")>("react");
      const actual = jest.requireActual<
        typeof import("@/components/shared/timeline/MarkdownRenderer")
      >("@/components/shared/timeline/MarkdownRenderer");
      return React.createElement(actual.MarkdownRenderer, props);
    }
    const { content } = props;
    return <div aria-label="Rendered gist body">{content}</div>;
  },
}));

jest.mock("mermaid", () => ({
  __esModule: true,
  default: {
    initialize: jest.fn(),
    render: mockMermaidRender,
  },
}));

jest.mock("@/components/skills/workspace/RichCodeEditor", () => ({
  RichCodeEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange?: (value: string) => void;
  }) => (
    <textarea
      aria-label="Markdown gist body"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

describe("GistView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRealMarkdownRenderer = false;
    window.localStorage.clear();
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        data: {
          gist: {
            id: "gist-1",
            title: "Example gist",
            body: "```youtube\nhttps://youtu.be/M7lc1UVf-VE\n```",
            author: "test-user",
            created_at: "2026-08-14T12:00:00.000Z",
            tags: [],
          },
        },
      }),
    ) as jest.Mock;
  });

  it("renders Mermaid in the gist read view through the real shared renderer", async () => {
    mockUseRealMarkdownRenderer = true;
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({
        data: {
          gist: {
            id: "gist-1",
            title: "Example gist",
            body: "```mermaid\nflowchart LR\nBrowser --> App\n```",
            author: "test-user",
            created_at: "2026-08-14T12:00:00.000Z",
            tags: [],
          },
        },
      }),
    );
    render(
      <GistView
        slug="example-project"
        id="gist-1"
        canEdit={false}
        onBack={jest.fn()}
      />,
    );

    await screen.findByText("Example gist");
    await waitFor(() =>
      expect(document.querySelector(".tome-mermaid-canvas svg")).toBeInTheDocument(),
    );
    expect(mockMarkdownRenderer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: "```mermaid\nflowchart LR\nBrowser --> App\n```",
        enableExcalidraw: true,
        enableExternalEmbeds: true,
        enableMermaid: true,
      }),
    );
    expect(document.querySelector(".tome-mermaid-error")).toBeNull();
    expect(screen.queryByText("plain text", { exact: true })).toBeNull();
    expect(screen.getByRole("button", { name: "Export this gist" })).toBeInTheDocument();
  });

  it("keeps gist metadata compact and reveals audit details in a tooltip", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({
        data: {
          gist: {
            id: "gist-1",
            title: "Example gist",
            filename: "example-gist.md",
            body: "Example markdown",
            author: "creator@example.test",
            created_at: "2026-08-14T12:00:00.000Z",
            updated_at: "2026-08-14T13:00:00.000Z",
            updated_by: "editor@example.test",
            tags: [],
          },
        },
      }),
    );

    render(
      <GistView
        slug="example-project"
        id="gist-1"
        canEdit={false}
        onBack={jest.fn()}
      />,
    );

    await screen.findByRole("heading", { name: "Example gist" });
    const metadata = screen.getByTestId("gist-author-meta");
    expect(metadata).toHaveTextContent("example-gist.md");
    expect(metadata).toHaveTextContent("creator@example.test");
    expect(metadata).toHaveTextContent("modified");
    expect(metadata).not.toHaveTextContent("editor@example.test");

    fireEvent.mouseEnter(
      screen.getByRole("button", {
        name: "View gist creation and modification details",
      }),
    );
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Created");
    expect(tooltip).toHaveTextContent("Created by");
    expect(tooltip).toHaveTextContent("Last modified");
    expect(tooltip).toHaveTextContent("Modified by");
    expect(tooltip).toHaveTextContent("creator@example.test");
    expect(tooltip).toHaveTextContent("editor@example.test");
  });

  it("renames the Markdown filename inline without changing the gist id", async () => {
    const original = {
      id: "gist-1",
      title: "Example gist",
      filename: "example-gist.md",
      body: "Original markdown",
      author: "test-user",
      created_at: "2026-08-14T12:00:00.000Z",
      tags: [],
    };
    (global.fetch as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce(jsonResponse({ data: { gist: original } }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { gist: { ...original, filename: "renamed.md" } } }),
      );

    render(
      <GistView
        slug="example-project"
        id="gist-1"
        canEdit
        onBack={jest.fn()}
      />,
    );

    await screen.findByRole("button", { name: "example-gist.md" });
    fireEvent.click(screen.getByRole("button", { name: "example-gist.md" }));
    const filenameInput = screen.getByRole("textbox", {
      name: "Rename gist filename (Enter to save, Esc to cancel)",
    });
    fireEvent.change(filenameInput, { target: { value: "renamed" } });
    fireEvent.keyDown(filenameInput, { key: "Enter" });

    await waitFor(() => expect(global.fetch).toHaveBeenLastCalledWith(
      "/api/tome/projects/example-project/gists/gist-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ filename: "renamed.md" }),
      }),
    ));
    expect(await screen.findByRole("button", { name: "renamed.md" })).toBeInTheDocument();
  });

  it("keeps gist metadata compact and reveals audit details in a tooltip", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({
        data: {
          gist: {
            id: "gist-1",
            title: "Example gist",
            filename: "example-gist.md",
            body: "Example markdown",
            author: "creator@example.test",
            created_at: "2026-08-14T12:00:00.000Z",
            updated_at: "2026-08-14T13:00:00.000Z",
            updated_by: "editor@example.test",
            tags: [],
          },
        },
      }),
    );

    render(
      <GistView
        slug="example-project"
        id="gist-1"
        canEdit={false}
        onBack={jest.fn()}
      />,
    );

    await screen.findByRole("heading", { name: "Example gist" });
    const metadata = screen.getByTestId("gist-author-meta");
    expect(metadata).toHaveTextContent("example-gist.md");
    expect(metadata).toHaveTextContent("creator@example.test");
    expect(metadata).toHaveTextContent("modified");
    expect(metadata).not.toHaveTextContent("editor@example.test");

    fireEvent.mouseEnter(
      screen.getByRole("button", {
        name: "View gist creation and modification details",
      }),
    );
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Created");
    expect(tooltip).toHaveTextContent("Created by");
    expect(tooltip).toHaveTextContent("Last modified");
    expect(tooltip).toHaveTextContent("Modified by");
    expect(tooltip).toHaveTextContent("creator@example.test");
    expect(tooltip).toHaveTextContent("editor@example.test");
  });

  it("renames the Markdown filename inline without changing the gist id", async () => {
    const original = {
      id: "gist-1",
      title: "Example gist",
      filename: "example-gist.md",
      body: "Original markdown",
      author: "test-user",
      created_at: "2026-08-14T12:00:00.000Z",
      tags: [],
    };
    (global.fetch as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce(jsonResponse({ data: { gist: original } }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { gist: { ...original, filename: "renamed.md" } } }),
      );

    render(
      <GistView
        slug="example-project"
        id="gist-1"
        canEdit
        onBack={jest.fn()}
      />,
    );

    await screen.findByRole("button", { name: "example-gist.md" });
    fireEvent.click(screen.getByRole("button", { name: "example-gist.md" }));
    const filenameInput = screen.getByRole("textbox", {
      name: "Rename gist filename (Enter to save, Esc to cancel)",
    });
    fireEvent.change(filenameInput, { target: { value: "renamed" } });
    fireEvent.keyDown(filenameInput, { key: "Enter" });

    await waitFor(() => expect(global.fetch).toHaveBeenLastCalledWith(
      "/api/tome/projects/example-project/gists/gist-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ filename: "renamed.md" }),
      }),
    ));
    expect(await screen.findByRole("button", { name: "renamed.md" })).toBeInTheDocument();
  });

  it("lets editors update a gist with the shared Rich, Markdown, and Preview modes", async () => {
    const updatedGist = {
      id: "gist-1",
      title: "Updated gist",
      body: "Updated markdown",
      author: "test-user",
      created_at: "2026-08-14T12:00:00.000Z",
      updated_at: "2026-08-14T13:00:00.000Z",
      updated_by: "editor@example.test",
      tags: ["updated"],
    };
    (global.fetch as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            gist: {
              id: "gist-1",
              title: "Example gist",
              body: "Original markdown",
              author: "test-user",
              created_at: "2026-08-14T12:00:00.000Z",
              tags: ["draft"],
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { gist: updatedGist } }));

    render(
      <GistView
        slug="example-project"
        id="gist-1"
        canEdit
        onBack={jest.fn()}
      />,
    );

    await screen.findByText("Example gist");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const titleTagsRow = screen.getByTestId("gist-title-tags-row");
    expect(titleTagsRow).toContainElement(screen.getByRole("textbox", { name: "Gist title" }));
    expect(titleTagsRow).toContainElement(screen.getByTestId("gist-author-meta"));
    expect(screen.getByTestId("gist-author-meta")).toHaveTextContent("test-user");
    expect(titleTagsRow).toContainElement(screen.getByRole("textbox", { name: "Add tag" }));
    expect(screen.getByRole("button", { name: "Rich" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Markdown" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByTestId("gist-editor-mode-toggle")).toBeInTheDocument();
    const editorCanvas = screen.getByTestId("gist-editor-canvas");
    expect(screen.getByTestId("gist-title-tags-row").nextElementSibling).toBe(editorCanvas);
    expect(editorCanvas).not.toHaveClass("mt-6");
    expect(screen.getByTestId("gist-scroll-area")).not.toHaveClass("ring-2");
    expect(screen.getByTestId("gist-scroll-area")).toHaveClass(
      "min-h-0",
      "[&_[data-radix-scroll-area-viewport]>div]:min-h-full",
    );
    expect(screen.getByTestId("gist-content-layout")).toHaveClass(
      "flex",
      "min-h-full",
      "flex-1",
      "flex-col",
    );
    expect(editorCanvas).toHaveClass(
      "flex-1",
      "ring-2",
      "ring-inset",
      "ring-amber-400/70",
    );
    expect(screen.getByRole("button", { name: "Use narrow content width" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("textbox", { name: "Gist body" }).closest(".tome-rich-editor-full-width"),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use narrow content width" }));
    expect(screen.getByTestId("gist-content-layout")).toHaveClass("max-w-[65rem]");
    expect(screen.getByRole("button", { name: "Use wide content width" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByRole("textbox", { name: "Gist body" }).closest(".tome-rich-editor-full-width"),
    ).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Gist title" }), {
      target: { value: "Updated gist" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Gist body" }), {
      target: { value: "Updated markdown" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove tag draft" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Add tag" }), {
      target: { value: "updated" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Add tag" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockMarkdownRenderer).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: "Updated markdown", enableMermaid: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenLastCalledWith(
        "/api/tome/projects/example-project/gists/gist-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            title: "Updated gist",
            filename: "example-gist.md",
            body: "Updated markdown",
            tags: ["updated"],
          }),
        }),
      ),
    );
    await screen.findByRole("heading", { name: "Updated gist" });
    expect(mockMarkdownRenderer).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: "Updated markdown", enableMermaid: true }),
    );
  });

  it("leaves a supported URL as a normal paste in Markdown source mode", async () => {
    render(
      <GistView
        slug="example-project"
        id="gist-1"
        canEdit
        onBack={jest.fn()}
      />,
    );

    await screen.findByText("Example gist");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    const editor = screen.getByRole("textbox", { name: "Markdown gist body" });

    const wasNotCancelled = fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: () => "https://arxiv.org/abs/1706.03762",
      },
    });

    expect(wasNotCancelled).toBe(true);
    expect((editor as HTMLTextAreaElement).value).not.toContain("```arxiv");
  });

  it("opens a blank full editor and creates a gist without a dialog", async () => {
    const onCreated = jest.fn();
    const createdGist = {
      id: "gist-new",
      title: "New context",
      body: "Useful markdown",
      author: "reader@example.test",
      created_at: "2026-08-14T12:00:00.000Z",
      tags: [],
    };
    (global.fetch as jest.Mock)
      .mockReset()
      .mockResolvedValue(jsonResponse({ data: { gist: createdGist } }));

    render(
      <GistView
        slug="example-project"
        canEdit={false}
        onBack={jest.fn()}
        onCreated={onCreated}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rich" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Markdown" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
    const metadata = screen.getByTestId("gist-author-meta");
    expect(metadata).toHaveTextContent("gist.md");
    expect(metadata).toHaveTextContent("New gist");
    expect(metadata).not.toHaveTextContent("saved outside the curated wiki");
    expect(global.fetch).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: "Gist title" }), {
      target: { value: "New context" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Gist body" }), {
      target: { value: "Useful markdown" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create gist" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      "/api/tome/projects/example-project/gists",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "New context",
          filename: "new-context.md",
          body: "Useful markdown",
          tags: [],
        }),
      }),
    ));
    expect(onCreated).toHaveBeenCalledWith("gist-new");
  });

  it("explains an oversized proxy response instead of exposing a JSON parse error", async () => {
    const original = {
      id: "gist-1",
      title: "Example gist",
      filename: "example-gist.md",
      body: "Original markdown",
      author: "creator@example.test",
      created_at: "2026-08-14T12:00:00.000Z",
      tags: [],
    };
    (global.fetch as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce(jsonResponse({ data: { gist: original } }))
      .mockResolvedValueOnce(
        htmlResponse("<html><h1>413 Request Entity Too Large</h1></html>", 413),
      );

    render(
      <GistView
        slug="example-project"
        id="gist-1"
        canEdit
        onBack={jest.fn()}
      />,
    );

    await screen.findByText("Example gist");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(
        "This gist is too large to save. Remove an embedded image or use a smaller image, then try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected token/)).not.toBeInTheDocument();
  });

  it("shows one concise local-draft status after content is entered", () => {
    const savedAt = new Date(2026, 8, 11, 20, 22, 36);
    jest.useFakeTimers();
    jest.setSystemTime(savedAt);

    const { unmount } = render(
      <GistView
        slug="example-project"
        canEdit
        onBack={jest.fn()}
      />,
    );

    expect(screen.queryByTestId("gist-draft-status")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Gist title" }), {
      target: { value: "Local draft" },
    });
    act(() => jest.advanceTimersByTime(500));

    const titleRow = screen.getByTestId("gist-title-tags-row");
    const status = screen.getByTestId("gist-draft-status");
    expect(screen.getAllByTestId("gist-author-meta")).toHaveLength(1);
    expect(screen.getAllByTestId("gist-draft-status")).toHaveLength(1);
    expect(titleRow).toContainElement(status);
    expect(screen.getByTestId("gist-editor-header")).not.toContainElement(status);
    expect(status).toHaveTextContent("Saved locally · Last saved");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute(
      "title",
      "Saved in this browser until you create the gist.",
    );
    expect(status.querySelector("time")).toHaveAttribute(
      "dateTime",
      new Date(savedAt.getTime() + 500).toISOString(),
    );

    unmount();
    jest.useRealTimers();
  });
});
