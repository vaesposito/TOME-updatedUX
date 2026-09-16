import { act, fireEvent, render,screen,waitFor } from "@testing-library/react";
import { MarkdownRenderer } from "../MarkdownRenderer";

const mockLoadLanguage = jest.fn();
const mockMermaidInitialize = jest.fn();
const mockMermaidRender = jest.fn(async (_id: string, _content: string) => ({
  svg: [
    '<svg id="tome-mermaid-test" viewBox="0 0 800 400" aria-roledescription="flowchart-v2" onload="alert(unsafe)">',
    "<title>Example architecture</title>",
    "<style>#tome-mermaid-test .nodeLabel{fill:#f8fafc}</style>",
    '<text class="nodeLabel">Visible label</text>',
    '<foreignObject><div class="nodeLabel" onclick="alert(unsafe)">Saved label</div></foreignObject>',
    '<script>alert("unsafe")</script>',
    "</svg>",
  ].join(""),
}));
const mockExcalidrawExportToSvg = jest.fn(async () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 600 400");
  svg.setAttribute("onload", "alert('unsafe')");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = ".excalidraw-label{fill:#123456}";
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("class", "excalidraw-label");
  text.textContent = "Visible drawing";
  const script = document.createElementNS("http://www.w3.org/2000/svg", "script");
  script.textContent = "alert('unsafe')";
  const foreignObject = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "foreignObject",
  );
  foreignObject.textContent = "interactive content";
  svg.append(style, text, script, foreignObject);
  return svg;
});
const EXCALIDRAW_CONTENT = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [
    { id: "shape-1", type: "rectangle", x: 0, y: 0, width: 100, height: 80 },
  ],
  appState: {},
  files: {},
});
const mockCodeToHtml = jest.fn(
  (code: string, options: { lang: string }) =>
    `<pre class="shiki" data-language="${options.lang}"><code>${code}</code></pre>`,
);

jest.mock("remend", () => ({
  __esModule: true,
  default: (content: string) => content,
}), { virtual: true });

jest.mock("marked-shiki", () => ({
  __esModule: true,
  default: ({
    highlight,
  }: {
    highlight: (code: string, lang: string, props: string[]) => Promise<string>;
  }) => ({
    async: true,
    async walkTokens(token: {
      type: string;
      lang?: string;
      text: string;
      block?: boolean;
    }) {
      if (token.type !== "code") return;
      const [lang = "text", ...props] = token.lang?.split(" ") ?? [];
      token.type = "html";
      token.block = true;
      token.text = `${await highlight(token.text, lang, props)}\n`;
    },
  }),
}));

jest.mock("shiki", () => ({
  bundledLanguages: { cpp: true, text: true },
  createHighlighter: jest.fn(async () => ({
    codeToHtml: mockCodeToHtml,
    getLoadedLanguages: () => ["text"],
    loadLanguage: mockLoadLanguage,
  })),
}));

jest.mock("mermaid", () => ({
  __esModule: true,
  default: {
    initialize: mockMermaidInitialize,
    render: mockMermaidRender,
  },
}));

jest.mock("@excalidraw/utils", () => ({
  exportToSvg: mockExcalidrawExportToSvg,
}));

describe("MarkdownRenderer links", () => {
  it("preserves nested, mixed, ordered, and task-list structure", async () => {
    const { container } = render(
      <MarkdownRenderer
        content={["- Parent", "  1. Ordered child", "     - Mixed grandchild", "- [x] Completed task"].join("\n")}
      />,
    );

    await waitFor(() => expect(container.querySelector("ul > li > ol > li > ul")).toBeInTheDocument());
    expect(container.querySelector('input[type="checkbox"]')).toBeChecked();
  });

  it("treats one newline as a soft wrap and a blank line as a paragraph", async () => {
    const { container } = render(
      <MarkdownRenderer content={"first line\nsecond line\n\nsecond paragraph"} />,
    );

    await waitFor(() => expect(container.querySelectorAll("p")).toHaveLength(2));
    expect(container.querySelector("br")).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe("first line\nsecond line");
  });

  it("normalizes editor display names before syntax highlighting", async () => {
    const { container } = render(
      <MarkdownRenderer
        content={["```C++", "int main() { return 0; }", "```"].join("\n")}
      />,
    );

    await waitFor(() =>
      expect(container.querySelector('pre[data-language="cpp"]')).toBeInTheDocument(),
    );
    expect(mockLoadLanguage).toHaveBeenCalledWith("cpp");
    expect(container.querySelector(".md-code-lang")).toHaveTextContent("cpp");
  });

  it("renders opted-in Mermaid fences as sanitized, expandable diagrams", async () => {
    const content = [
      "```mermaid",
      "flowchart LR",
      "  Browser --> App",
      "```",
    ].join("\n");
    const disabled = render(<MarkdownRenderer content={content} />);

    await waitFor(() =>
      expect(disabled.container.querySelector('pre[data-language="mermaid"]')).toBeInTheDocument(),
    );
    expect(disabled.container.querySelector(".tome-mermaid-preview")).toBeNull();
    expect(disabled.container.querySelector(".md-code-lang")).toHaveTextContent("mermaid");
    disabled.unmount();

    const enabled = render(<MarkdownRenderer content={content} enableMermaid />);

    await waitFor(() =>
      expect(enabled.container.querySelector(".tome-mermaid-canvas svg")).toBeInTheDocument(),
    );
    expect(mockMermaidInitialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
    });
    expect(mockMermaidRender).toHaveBeenCalledWith(
      expect.stringMatching(/^tome-mermaid-\d+$/),
      "flowchart LR\n  Browser --> App",
    );
    expect(enabled.container.querySelector("script")).toBeNull();
    expect(enabled.container.querySelector("style")?.textContent).toContain(
      "#tome-mermaid-test .nodeLabel",
    );
    expect(enabled.container.querySelector("svg")).not.toHaveAttribute("onload");
    expect(enabled.container.querySelector(".nodeLabel")).toHaveTextContent("Visible label");
    expect(enabled.container.querySelector("foreignObject")).toHaveTextContent("Saved label");
    expect(enabled.container.querySelector("[onclick]")).toBeNull();
    expect(enabled.container.querySelector(".md-code-block")).toBeNull();
    expect(enabled.container).not.toHaveTextContent("plain text");

    fireEvent.click(enabled.getByRole("button", { name: "Expand Mermaid diagram" }));
    const dialog = await screen.findByRole("dialog", { name: "Mermaid diagram" });
    expect(dialog.querySelector(".tome-mermaid-lightbox-canvas svg")).toHaveAttribute(
      "aria-roledescription",
      "flowchart-v2",
    );
  });

  it("shows actionable Mermaid syntax errors in saved views", async () => {
    mockMermaidRender.mockRejectedValueOnce(
      new Error("Parse error on line 2: Unexpected token"),
    );
    const { container } = render(
      <MarkdownRenderer
        content={[
          "```mermaid",
          "flowchart LR",
          "  API --> Broken[",
          "```",
        ].join("\n")}
        enableMermaid
      />,
    );

    await waitFor(() =>
      expect(container.querySelector(".tome-mermaid-error")).toBeInTheDocument(),
    );
    const alert = container.querySelector(".tome-mermaid-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert?.querySelector(".tome-mermaid-error-title")).toHaveTextContent(
      "Mermaid syntax error",
    );
    expect(alert?.querySelector(".tome-mermaid-error-summary")).toHaveTextContent(
      "Line 2 · Parse error · Unexpected token",
    );
    expect(alert?.querySelector(".tome-mermaid-error-excerpt")).toHaveTextContent(
      "2 | API --> Broken[",
    );
    expect(container.querySelector(".md-code-block")).toBeNull();
  });

  it("re-renders saved Mermaid diagrams when the app theme changes", async () => {
    const root = document.documentElement;
    root.setAttribute("data-theme-preference", "dark");
    root.setAttribute("data-theme", "dark");
    const initialRenderCount = mockMermaidRender.mock.calls.length;
    const { container, unmount } = render(
      <MarkdownRenderer
        content={"```mermaid\nflowchart LR\n  Browser --> App\n```"}
        enableMermaid
      />,
    );

    await waitFor(() =>
      expect(mockMermaidRender).toHaveBeenCalledTimes(initialRenderCount + 1),
    );
    expect(mockMermaidInitialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "dark" }),
    );

    act(() => {
      root.setAttribute("data-theme-preference", "light");
      root.setAttribute("data-theme", "light");
      window.dispatchEvent(new Event("caipe:theme-change"));
    });

    await waitFor(() =>
      expect(mockMermaidRender).toHaveBeenCalledTimes(initialRenderCount + 2),
    );
    expect(mockMermaidInitialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "default" }),
    );
    expect(container.querySelector("style")?.textContent).toContain(
      "#tome-mermaid-test .nodeLabel",
    );

    unmount();
    root.removeAttribute("data-theme-preference");
    root.removeAttribute("data-theme");
  });

  it("renders opted-in Excalidraw fences as sanitized native drawings", async () => {
    const content = `\`\`\`excalidraw\n${EXCALIDRAW_CONTENT}\n\`\`\``;
    const disabled = render(<MarkdownRenderer content={content} />);

    await waitFor(() =>
      expect(
        disabled.container.querySelector('pre[data-language="excalidraw"]'),
      ).toBeInTheDocument(),
    );
    expect(disabled.container.querySelector(".tome-excalidraw-preview")).toBeNull();
    expect(disabled.container.querySelector(".md-code-lang")).toHaveTextContent(
      "excalidraw",
    );
    disabled.unmount();

    const enabled = render(
      <MarkdownRenderer content={content} enableExcalidraw />,
    );
    await waitFor(() =>
      expect(
        enabled.container.querySelector(".tome-excalidraw-canvas svg"),
      ).toBeInTheDocument(),
    );
    expect(enabled.container.querySelector("script")).toBeNull();
    expect(enabled.container.querySelector("foreignObject")).toBeNull();
    expect(enabled.container.querySelector("svg")).not.toHaveAttribute("onload");
    expect(enabled.container.querySelector("style")).toHaveTextContent(
      ".excalidraw-label",
    );
    expect(enabled.container.querySelector(".excalidraw-label")).toHaveTextContent(
      "Visible drawing",
    );
    expect(enabled.container.querySelector(".md-code-block")).toBeNull();
    expect(enabled.container).not.toHaveTextContent("plain text");

    fireEvent.click(
      enabled.getByRole("button", { name: "Expand Excalidraw drawing" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Excalidraw diagram" }),
    ).toBeInTheDocument();
  });

  it("re-renders saved Excalidraw drawings when the app theme changes", async () => {
    const root = document.documentElement;
    root.setAttribute("data-theme-preference", "light");
    root.setAttribute("data-theme", "light");
    const initialExportCount = mockExcalidrawExportToSvg.mock.calls.length;
    const { unmount } = render(
      <MarkdownRenderer
        content={`\`\`\`excalidraw\n${EXCALIDRAW_CONTENT}\n\`\`\``}
        enableExcalidraw
      />,
    );

    await waitFor(() =>
      expect(mockExcalidrawExportToSvg).toHaveBeenCalledTimes(initialExportCount + 1),
    );
    expect(mockExcalidrawExportToSvg).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          appState: expect.objectContaining({ exportWithDarkMode: false }),
        }),
        config: expect.objectContaining({ theme: "light" }),
      }),
    );

    act(() => {
      root.setAttribute("data-theme-preference", "dark");
      root.setAttribute("data-theme", "dark");
      window.dispatchEvent(new Event("caipe:theme-change"));
    });
    await waitFor(() =>
      expect(mockExcalidrawExportToSvg).toHaveBeenCalledTimes(initialExportCount + 2),
    );
    expect(mockExcalidrawExportToSvg).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          appState: expect.objectContaining({ exportWithDarkMode: true }),
        }),
        config: expect.objectContaining({ theme: "dark" }),
      }),
    );

    unmount();
    root.removeAttribute("data-theme-preference");
    root.removeAttribute("data-theme");
  });

  it("does not apply stale Mermaid output after the Markdown changes", async () => {
    let resolveFirst: ((value: { svg: string }) => void) | undefined;
    const initialRenderCount = mockMermaidRender.mock.calls.length;
    mockMermaidRender
      .mockImplementationOnce(
        async () =>
          new Promise<{ svg: string }>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        svg: '<svg aria-label="Current diagram" viewBox="0 0 400 200"></svg>',
      });
    const { container, rerender } = render(
      <MarkdownRenderer
        content={"```mermaid\nflowchart LR\nOld --> Diagram\n```"}
        enableMermaid
      />,
    );
    await waitFor(() =>
      expect(mockMermaidRender).toHaveBeenCalledTimes(initialRenderCount + 1),
    );

    rerender(
      <MarkdownRenderer
        content={"```mermaid\nflowchart LR\nCurrent --> Diagram\n```"}
        enableMermaid
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('svg[aria-label="Current diagram"]')).toBeInTheDocument(),
    );

    await act(async () => {
      resolveFirst?.({
        svg: '<svg aria-label="Stale diagram" viewBox="0 0 400 200"></svg>',
      });
    });
    expect(container.querySelector('svg[aria-label="Current diagram"]')).toBeInTheDocument();
    expect(container.querySelector('svg[aria-label="Stale diagram"]')).toBeNull();
  });

  it("opens external and relative links in a new tab", async () => {
    render(
      <MarkdownRenderer
        content="[External](https://example.com/docs) [Internal](/chat/example)"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "External" })).toHaveAttribute("target", "_blank");
      expect(screen.getByRole("link", { name: "Internal" })).toHaveAttribute("target", "_blank");
    });

    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("renders allowlisted external embeds only when explicitly enabled", async () => {
    const content = [
      "```vidcast",
      "url: https://app.vidcast.io/share/embed/4e2a9de5-2d25-420b-a59a-acdb321bd1b3",
      "title: Example Vidcast",
      "```",
      "",
      "```youtube",
      "url: https://www.youtube.com/watch?v=b4STimVN60E",
      "title: Example video",
      "```",
      "",
      "```arxiv",
      "url: https://arxiv.org/html/2607.12662v1",
      "title: Example paper",
      "```",
      "",
      "```pdf",
      "url: https://example.com/files/guide.pdf",
      "title: Example PDF",
      "```",
    ].join("\n");
    const disabled = render(<MarkdownRenderer content={content} />);

    await waitFor(() => expect(disabled.container.querySelector("pre")).toBeInTheDocument());
    expect(disabled.container.querySelector("iframe")).toBeNull();
    disabled.unmount();

    const enabled = render(
      <MarkdownRenderer content={content} enableExternalEmbeds />,
    );
    await waitFor(() =>
      expect(enabled.container.querySelectorAll("iframe")).toHaveLength(4),
    );

    expect(enabled.container.querySelector(".tome-vidcast-iframe")).toHaveAttribute(
      "src",
      "https://app.vidcast.io/share/embed/4e2a9de5-2d25-420b-a59a-acdb321bd1b3",
    );
    expect(enabled.container.querySelector(".tome-youtube-iframe")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/b4STimVN60E",
    );
    expect(enabled.container.querySelector(".tome-arxiv-iframe")).toHaveAttribute(
      "src",
      "https://arxiv.org/html/2607.12662v1",
    );
    expect(enabled.container.querySelector(".tome-arxiv-iframe")).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-presentation",
    );
    expect(enabled.container.querySelector(".tome-pdf-iframe")).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-presentation",
    );
    expect(enabled.container.querySelector(".tome-embed-toolbar")).toBeNull();
    expect(enabled.container.querySelector(".tome-embed-remove")).toBeNull();
    expect(enabled.container.querySelector(".tome-vidcast-playlist-toggle")).toBeNull();
    expect(enabled.container.querySelector(".tome-media-alignment")).toBeNull();
    expect(enabled.container.querySelector(".tome-media-resize")).toBeNull();
  });

  it("preserves responsive widths for video embeds and block images", async () => {
    const { container } = render(
      <MarkdownRenderer
        content={[
          "```youtube",
          "url: https://www.youtube.com/watch?v=b4STimVN60E",
          "width: 60%",
          "```",
          "",
          '![0.55|right](https://example.com/example.png "Example diagram")',
        ].join("\n")}
        enableExternalEmbeds
      />,
    );

    await waitFor(() => expect(container.querySelector("iframe")).toBeInTheDocument());
    expect(container.querySelector(".tome-embed-preview")).toHaveStyle(
      "--tome-media-width: 60%",
    );
    const figure = container.querySelector("figure.tome-image-figure");
    const image = figure?.querySelector("img");
    expect(figure).toHaveStyle("--tome-media-width: 55%");
    expect(figure).toHaveAttribute("data-media-align", "right");
    expect(image).toHaveAttribute("alt", "Example diagram");
    expect(figure?.querySelector("figcaption")).toHaveTextContent("Example diagram");
  });

  it("shows a safe error for invalid opted-in embeds", async () => {
    const { container } = render(
      <MarkdownRenderer
        content={[
          "```youtube",
          "https://example.test/watch?v=M7lc1UVf-VE",
          "```",
        ].join("\n")}
        enableExternalEmbeds
      />,
    );

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeInTheDocument());
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector(".tome-embed-remove")).toBeNull();
    expect(container.textContent).toContain("Could not embed YouTube");
  });

  it("renders opted-in Tome column markers as a responsive section", async () => {
    const content = [
      "> [!column]",
      ">",
      "> ### First",
      ">",
      "> Alpha",
      "",
      "> [!column]",
      ">",
      "> ### Second",
      ">",
      "> Beta",
    ].join("\n");

    const disabled = render(<MarkdownRenderer content={content} />);
    await waitFor(() => expect(disabled.container.querySelectorAll("blockquote")).toHaveLength(2));
    expect(disabled.container.querySelector(".tome-columns")).toBeNull();
    disabled.unmount();

    const enabled = render(<MarkdownRenderer content={content} enableTomeColumns />);
    await waitFor(() => expect(enabled.container.querySelector(".tome-columns")).toBeInTheDocument());
    const columns = enabled.container.querySelector(".tome-columns");
    expect(columns).toHaveAttribute("data-column-count", "2");
    expect(columns?.querySelectorAll("blockquote.tome-column")).toHaveLength(2);
    expect(columns).not.toHaveTextContent("[!column]");
    expect(columns).toHaveTextContent("First");
    expect(columns).toHaveTextContent("Second");
  });

  it("keeps columns grouped across preserved empty lines", async () => {
    const content = [
      "> [!column]",
      ">",
      "> ### First",
      "",
      "<br />",
      "",
      "<br />",
      "",
      "> [!column]",
      ">",
      "> ### Second",
    ].join("\n");

    const { container } = render(
      <MarkdownRenderer content={content} enableTomeColumns />,
    );

    await waitFor(() => expect(container.querySelector(".tome-columns")).toBeInTheDocument());
    const columns = container.querySelector(".tome-columns");
    expect(columns).toHaveAttribute("data-column-count", "2");
    expect(columns?.querySelectorAll("blockquote.tome-column")).toHaveLength(2);
    expect(columns?.querySelector("br")).toBeNull();
    expect(columns).toHaveTextContent("First");
    expect(columns).toHaveTextContent("Second");
  });
});
