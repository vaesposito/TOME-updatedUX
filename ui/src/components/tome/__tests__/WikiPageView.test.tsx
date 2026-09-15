import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { WikiPageView } from "../WikiPageView";

const mockAiContext = jest.fn();
const mockCaptureSelection = jest.fn();
const mockRestoreSelection = jest.fn();

jest.mock("@/components/ai-assist", () => ({
  AiAssistButton: ({
    getContext,
    onApply,
    open,
    onOpenChange,
  }: {
    getContext: () => unknown;
    onApply: (value: string) => void;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <>
      <button
        type="button"
        data-open={String(Boolean(open))}
        onClick={() => {
          mockAiContext(getContext());
          onApply("AI-generated Markdown");
        }}
      >
        AI
      </button>
      {open && (
        <button type="button" onClick={() => onOpenChange?.(false)}>
          Discard AI suggestion
        </button>
      )}
    </>
  ),
}));

jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

jest.mock("@/components/shared/timeline/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <textarea aria-label="Wiki preview" value={content} readOnly />
  ),
}));

jest.mock("@/components/skills/workspace/RichCodeEditor", () => ({
  RichCodeEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="Markdown source editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

jest.mock("@/components/tome/CrepeEditor", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    CrepeEditor: React.forwardRef(function MockCrepeEditor(
      {
        initialMarkdown,
        readonly,
        onChange,
        onEnhanceSelection,
      }: {
        initialMarkdown: string;
        readonly: boolean;
        onChange?: (value: string) => void;
        onEnhanceSelection?: () => void;
      },
      ref: React.ForwardedRef<{
        getMarkdown: () => string;
        insertMarkdown: (value: string) => void;
        getSelectedText: () => string;
        replaceSelection: (value: string) => void;
      }>,
    ) {
      const [value, setValue] = React.useState(initialMarkdown);
      React.useImperativeHandle(ref, () => ({
        getMarkdown: () => value,
        insertMarkdown: () => {},
        getSelectedText: () => "Selected sentence",
        captureSelection: mockCaptureSelection,
        restoreSelection: mockRestoreSelection,
        replaceSelection: (next: string) => {
          setValue(next);
          onChange?.(next);
        },
      }), [onChange, value]);
      return (
        <>
          <textarea
            aria-label={readonly ? "Wiki preview" : "Wiki editor"}
            value={value}
            readOnly={readonly}
            onChange={(event) => {
              setValue(event.target.value);
              onChange?.(event.target.value);
            }}
          />
          {!readonly && onEnhanceSelection && (
            <button type="button" onClick={onEnhanceSelection}>
              Enhance with AI
            </button>
          )}
        </>
      );
    }),
  };
});

describe("WikiPageView", () => {
  const openEditor = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    });
    expect(screen.getByRole("textbox", { name: "Wiki editor" })).toBeInTheDocument();
  };

  beforeEach(() => {
    mockAiContext.mockClear();
    mockCaptureSelection.mockClear();
    mockRestoreSelection.mockClear();
    window.localStorage.clear();
  });

  it("shows when the browser last saved the local draft", async () => {
    const savedAt = new Date(2026, 8, 11, 17, 56, 27);
    jest.useFakeTimers();
    jest.setSystemTime(savedAt);
    window.localStorage.clear();

    const { container, unmount } = render(
      <WikiPageView
        slug="example-project"
        path="charter.md"
        markdown={"---\ntitle: Example charter\nkind: stable\n---\nOriginal markdown"}
        onWrite={jest.fn().mockResolvedValue(undefined)}
        onReload={jest.fn()}
      />,
    );

    await openEditor();
    act(() => jest.advanceTimersByTime(500));

    const persistedAt = new Date(savedAt.getTime() + 500);
    const titleRow = screen.getByTestId("tome-page-title-row");
    const draftStatus = screen.getByTestId("tome-draft-status");
    const savedTime = container.querySelector("time");
    expect(titleRow).toContainElement(draftStatus);
    expect(screen.getByText("Draft saved locally")).toBeInTheDocument();
    expect(savedTime).toHaveAttribute("dateTime", persistedAt.toISOString());
    expect(savedTime).toHaveTextContent(
      persistedAt.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
    expect(JSON.parse(window.localStorage.getItem("tome:draft:example-project:charter.md")!))
      .toMatchObject({ updatedAt: persistedAt.toISOString() });

    unmount();
    jest.useRealTimers();
  });

  it("keeps the agent-rewrite caution in the page title row", async () => {
    render(
      <WikiPageView
        slug="example-project"
        path="roadmap.md"
        markdown={"---\ntitle: Roadmap\nkind: dynamic\n---\nRoadmap content"}
        onWrite={jest.fn().mockResolvedValue(undefined)}
        onReload={jest.fn()}
      />,
    );

    await openEditor();

    const titleRow = screen.getByTestId("tome-page-title-row");
    const warning = screen.getByTestId("tome-dynamic-warning");
    expect(titleRow).toContainElement(warning);
    expect(warning).toHaveTextContent("Agent rewrites on ingest");
  });

  it("uses the full editing canvas in Rich mode", async () => {
    render(
      <WikiPageView
        slug="example-project"
        path="charter.md"
        markdown={"---\ntitle: Example charter\nkind: stable\n---\nOriginal markdown"}
        onWrite={jest.fn().mockResolvedValue(undefined)}
        onReload={jest.fn()}
      />,
    );

    await openEditor();

    expect(screen.getByTestId("tome-page-editor-scroll")).toHaveClass("min-h-0");

    expect(
      screen
        .getByRole("textbox", { name: "Wiki editor" })
        .closest(".tome-rich-editor-full-width"),
    ).not.toBeNull();
  });

  it("shows and renames only the filename while preserving its folder", async () => {
    const onRename = jest.fn().mockResolvedValue(undefined);

    render(
      <WikiPageView
        slug="example-project"
        path="meetings/17.08.2026.md"
        markdown={"---\ntitle: Example meeting\nkind: stable\n---\nMeeting notes"}
        onWrite={jest.fn().mockResolvedValue(undefined)}
        onReload={jest.fn()}
        onRename={onRename}
      />,
    );

    expect(
      screen.getByRole("button", { name: "17.08.2026.md" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("meetings/17.08.2026.md")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "17.08.2026.md" }));
    const filenameInput = screen.getByRole("textbox", {
      name: "Rename page file name (Enter to save, Esc to cancel)",
    });
    expect(filenameInput).toHaveValue("17.08.2026.md");
    fireEvent.change(filenameInput, { target: { value: "18.08.2026.md" } });
    fireEvent.keyDown(filenameInput, { key: "Enter" });

    await waitFor(() =>
      expect(onRename).toHaveBeenCalledWith(
        "meetings/17.08.2026.md",
        "meetings/18.08.2026.md",
      ),
    );
  });

  it("opens a newly created page directly in the editor", async () => {
    const onAutoStartEditing = jest.fn();

    render(
      <WikiPageView
        slug="example-project"
        path="notes.md"
        markdown="# Notes\n"
        onWrite={jest.fn().mockResolvedValue(undefined)}
        onReload={jest.fn()}
        autoStartEditing
        onAutoStartEditing={onAutoStartEditing}
      />,
    );

    expect(await screen.findByRole("textbox", { name: "Wiki editor" })).toBeInTheDocument();
    expect(onAutoStartEditing).toHaveBeenCalledTimes(1);
  });

  it("captures the current revision before saving an auto-opened page", async () => {
    const onWrite = jest.fn().mockResolvedValue(undefined);
    (global.fetch as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            revisions: [{
              id: "revision-created",
              author: "test-user@example.com",
              created_at: "2026-09-15T18:18:54.000Z",
            }],
          },
        }),
      }),
    );

    render(
      <WikiPageView
        slug="example-project"
        path="notes.md"
        markdown="# Notes\n"
        onWrite={onWrite}
        onReload={jest.fn()}
        autoStartEditing
      />,
    );

    const editor = await screen.findByRole("textbox", { name: "Wiki editor" });
    fireEvent.change(editor, { target: { value: "Updated notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    expect(onWrite).toHaveBeenCalledWith(
      "notes.md",
      expect.stringContaining("Updated notes"),
      "edit notes.md",
      { baseRevisionId: "revision-created" },
    );
  });

  it("applies an AI suggestion only at the rich editor selection", async () => {
    render(
      <WikiPageView
        slug="example-project"
        path="charter.md"
        markdown={"---\ntitle: Example charter\nkind: stable\n---\nOriginal markdown"}
        onWrite={jest.fn().mockResolvedValue(undefined)}
        onReload={jest.fn()}
      />,
    );

    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    expect(mockAiContext).toHaveBeenCalledWith(expect.objectContaining({
      current_value: "Selected sentence",
      extra_context: expect.stringContaining("Page: charter.md"),
    }));
    expect(screen.getByRole("textbox", { name: "Wiki editor" })).toHaveValue(
      "AI-generated Markdown",
    );
  });

  it("opens AI Assist from the rich text selection toolbar", async () => {
    render(
      <WikiPageView
        slug="example-project"
        path="charter.md"
        markdown={"---\ntitle: Example charter\nkind: stable\n---\nOriginal markdown"}
        onWrite={jest.fn().mockResolvedValue(undefined)}
        onReload={jest.fn()}
      />,
    );

    await openEditor();
    expect(screen.getByRole("button", { name: "AI" })).toHaveAttribute(
      "data-open",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "Enhance with AI" }));
    expect(mockCaptureSelection).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "AI" })).toHaveAttribute(
      "data-open",
      "true",
    );
  });

  it("restores the rich editor selection when an AI suggestion is discarded", async () => {
    render(
      <WikiPageView
        slug="example-project"
        path="charter.md"
        markdown={"---\ntitle: Example charter\nkind: stable\n---\nOriginal markdown"}
        onWrite={jest.fn().mockResolvedValue(undefined)}
        onReload={jest.fn()}
      />,
    );

    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Enhance with AI" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard AI suggestion" }));

    expect(mockRestoreSelection).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "Wiki editor" })).toHaveValue(
      "Original markdown",
    );
  });

  it("previews an unsaved rich edit before saving", async () => {
    const onWrite = jest.fn().mockResolvedValue(undefined);

    render(
      <WikiPageView
        slug="example-project"
        path="charter.md"
        markdown={"---\ntitle: Example charter\nkind: stable\n---\nOriginal markdown"}
        onWrite={onWrite}
        onReload={jest.fn()}
      />,
    );

    await openEditor();
    fireEvent.change(screen.getByRole("textbox", { name: "Wiki editor" }), {
      target: { value: "Updated markdown" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByRole("button", { name: "Rich" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Wiki preview" })).toHaveValue(
      "Updated markdown",
    );
    expect(onWrite).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    expect(onWrite).toHaveBeenCalledWith(
      "charter.md",
      expect.stringContaining("Updated markdown"),
      "edit charter.md",
      { baseRevisionId: null },
    );
  });

  it("preserves a raw draft while entering and leaving preview", async () => {
    const onWrite = jest.fn().mockResolvedValue(undefined);

    render(
      <WikiPageView
        slug="example-project"
        path="charter.md"
        markdown={"---\ntitle: Example charter\nkind: stable\n---\nOriginal markdown"}
        onWrite={onWrite}
        onReload={jest.fn()}
      />,
    );

    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    const source = "---\ntitle: Example charter\nkind: stable\n---\nUpdated raw markdown";
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown source editor" }), {
      target: { value: source },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByRole("textbox", { name: "Wiki preview" })).toHaveValue(
      "Updated raw markdown",
    );

    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    expect(screen.getByRole("textbox", { name: "Markdown source editor" })).toHaveValue(source);
  });

  it("converts a supported URL pasted into Markdown source mode", async () => {
    render(
      <WikiPageView
        slug="example-project"
        path="charter.md"
        markdown={"---\ntitle: Example charter\nkind: stable\n---\nOriginal markdown"}
        onWrite={jest.fn().mockResolvedValue(undefined)}
        onReload={jest.fn()}
      />,
    );

    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    const editor = screen.getByRole("textbox", { name: "Markdown source editor" });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: () => "https://arxiv.org/pdf/1706.03762.pdf",
      },
    });

    expect((editor as HTMLTextAreaElement).value).toContain(
      "```arxiv\nurl: https://arxiv.org/pdf/1706.03762.pdf\n```",
    );
  });
});
