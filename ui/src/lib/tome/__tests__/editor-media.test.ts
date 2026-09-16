import mermaid from "mermaid";

import {
  hydrateEmbedPreviews,
  imageFileToDataUrl,
  renderTomeCodePreview,
} from "../editor-media";

const VIDEO_ID = "de4fc0eb-7146-4044-86a3-60c3cbd976a3";
const PLAYLIST_ID = "daa5d80c-9272-4587-989b-91d6c5f35b93";

jest.mock("mermaid", () => ({
  __esModule: true,
  default: {
    initialize: jest.fn(),
    render: jest.fn(),
  },
}));

const mockedMermaid = mermaid as jest.Mocked<typeof mermaid>;

describe("TOME editor media", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders Mermaid code through the async preview callback", async () => {
    mockedMermaid.render.mockResolvedValue({ svg: "<svg>diagram</svg>" } as never);
    const firstPreview = jest.fn();
    const secondPreview = jest.fn();

    expect(renderTomeCodePreview("mermaid", "graph TD; A-->B", firstPreview)).toBeUndefined();
    expect(renderTomeCodePreview(" MERMAID ", "flowchart LR; C-->D", secondPreview)).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockedMermaid.initialize).toHaveBeenCalledTimes(2);
    expect(mockedMermaid.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
    });
    expect(mockedMermaid.render).toHaveBeenNthCalledWith(1, "tome-mermaid-0", "graph TD; A-->B");
    expect(mockedMermaid.render).toHaveBeenNthCalledWith(
      2,
      "tome-mermaid-1",
      "flowchart LR; C-->D",
    );
    for (const applyPreview of [firstPreview, secondPreview]) {
      const markup = applyPreview.mock.calls[0]?.[0] as string;
      const container = document.createElement("div");
      container.innerHTML = markup;
      expect(
        container.querySelector("button.tome-mermaid-expand"),
      ).toHaveAccessibleName("Expand Mermaid diagram");
      expect(container.querySelector(".tome-mermaid-canvas svg")?.textContent).toBe(
        "diagram",
      );
    }
  });

  it("renders Mermaid with the selected light or dark palette", async () => {
    mockedMermaid.render.mockResolvedValue({ svg: "<svg>diagram</svg>" } as never);

    renderTomeCodePreview("mermaid", "graph TD; A-->B", jest.fn(), "legacy-light");
    renderTomeCodePreview("mermaid", "graph TD; A-->B", jest.fn(), "nord");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockedMermaid.initialize).toHaveBeenNthCalledWith(1, {
      startOnLoad: false,
      securityLevel: "strict",
      theme: "default",
    });
    expect(mockedMermaid.initialize).toHaveBeenNthCalledWith(2, {
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
    });
  });

  it("leaves non-Mermaid code blocks unchanged", () => {
    const applyPreview = jest.fn();

    expect(renderTomeCodePreview("typescript", "const value = 1", applyPreview)).toBeNull();
    expect(applyPreview).not.toHaveBeenCalled();
  });

  it("leaves blank Mermaid code blocks unchanged", () => {
    const applyPreview = jest.fn();

    expect(renderTomeCodePreview("mermaid", "  \n", applyPreview)).toBeNull();
    expect(mockedMermaid.render).not.toHaveBeenCalled();
    expect(applyPreview).not.toHaveBeenCalled();
  });

  it("explains Mermaid syntax errors with the source line and safe details", async () => {
    let orphanId = "";
    mockedMermaid.render.mockImplementation(async (renderId) => {
      orphanId = `d${renderId}`;
      const orphan = document.createElement("div");
      orphan.id = orphanId;
      orphan.innerHTML = '<svg aria-roledescription="error"></svg>';
      document.body.append(orphan);
      throw new Error(
        'Lexical error on line 2. Unrecognized text.\n<img src=x onerror="globalThis.compromised=true">',
      );
    });
    const applyPreview = jest.fn();

    renderTomeCodePreview(
      "mermaid",
      "flowchart LR\nAPI --> WS[/project/project-id/canonical-path]",
      applyPreview,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const alert = applyPreview.mock.calls[0]?.[0] as HTMLElement;
    expect(alert).toBeInstanceOf(HTMLElement);
    expect(alert).toHaveClass("tome-mermaid-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.querySelector(".tome-mermaid-error-title")).toHaveTextContent(
      "Mermaid syntax error",
    );
    expect(alert.querySelector(".tome-mermaid-error-summary")).toHaveTextContent(
      "Line 2 · Lexical error · Unrecognized text.",
    );
    expect(alert.querySelector(".tome-mermaid-error-excerpt")).toHaveTextContent(
      "2 | API --> WS[/project/project-id/canonical-path]",
    );
    expect(alert.querySelector(".tome-mermaid-error-hint")).toHaveTextContent(
      "Check brackets, quotes, arrows, and diagram keywords, then preview again.",
    );
    expect(alert.querySelector("details")).not.toHaveAttribute("open");
    expect(alert.textContent).toContain("<img src=x");
    expect(alert.querySelector("img")).toBeNull();
    expect(orphanId).not.toBe("");
    expect(document.getElementById(orphanId)).toBeNull();
  });

  it("uses a helpful fallback for non-parser Mermaid failures", async () => {
    mockedMermaid.render.mockRejectedValue(new Error("Renderer unavailable"));
    const applyPreview = jest.fn();

    renderTomeCodePreview("mermaid", "flowchart LR; A-->B", applyPreview);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const alert = applyPreview.mock.calls[0]?.[0] as HTMLElement;
    expect(alert.querySelector(".tome-mermaid-error-title")).toHaveTextContent(
      "Could not render Mermaid diagram",
    );
    expect(alert.querySelector(".tome-mermaid-error-summary")).toHaveTextContent(
      "Mermaid could not render this diagram.",
    );
    expect(alert.querySelector(".tome-mermaid-error-excerpt")).toBeNull();
    expect(alert.querySelector(".tome-mermaid-error-hint")).toHaveTextContent(
      "Try editing the Mermaid source and previewing again.",
    );
    expect(alert.querySelector(".tome-mermaid-error-details pre")).toHaveTextContent(
      "Renderer unavailable",
    );
  });

  it("renders and hydrates a validated Vidcast block", () => {
    const applyPreview = jest.fn();

    renderTomeCodePreview(
      "vidcast",
      [
        `url: https://app.vidcast.io/share/embed/${VIDEO_ID}`,
        "title: CAIPE Demo July 2026",
      ].join("\n"),
      applyPreview,
    );

    const root = document.createElement("div");
    root.append(applyPreview.mock.calls[0]?.[0] as HTMLElement);
    expect(root.querySelector("iframe")).toBeNull();

    hydrateEmbedPreviews(root);

    const iframe = root.querySelector("iframe");
    expect(iframe).toHaveAttribute(
      "src",
      `https://app.vidcast.io/share/embed/${VIDEO_ID}`,
    );
    expect(iframe).toHaveAttribute("title", "CAIPE Demo July 2026");
    expect(iframe).toHaveAttribute("loading", "lazy");
    expect(iframe).toHaveAttribute("allow", "fullscreen; autoplay; clipboard-write");
    expect(iframe).toHaveAttribute("allowfullscreen");
    expect(root.querySelector(".tome-embed-link")).toHaveAttribute(
      "href",
      `https://app.vidcast.io/share/${VIDEO_ID}`,
    );
    expect(root.querySelector("button.tome-embed-remove")).toHaveAccessibleName(
      "Remove Vidcast embed",
    );
  });

  it("shows a safe error instead of previewing an untrusted Vidcast URL", () => {
    const applyPreview = jest.fn();

    renderTomeCodePreview(
      "vidcast",
      "https://example.test/share/embed/de4fc0eb-7146-4044-86a3-60c3cbd976a3",
      applyPreview,
    );

    const alert = applyPreview.mock.calls[0]?.[0] as HTMLElement;
    expect(alert).toHaveClass("tome-embed-error", "tome-vidcast-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent).toContain("app.vidcast.io");
    expect(alert.querySelector("iframe")).toBeNull();
    expect(alert.querySelector("button.tome-embed-remove")).toHaveAccessibleName(
      "Remove Vidcast embed",
    );
  });

  it("renders and hydrates a Vidcast playlist player", () => {
    const applyPreview = jest.fn();

    renderTomeCodePreview(
      "vidcast",
      `url: https://app.vidcast.io/playlists/${PLAYLIST_ID}`,
      applyPreview,
    );
    const root = document.createElement("div");
    root.append(applyPreview.mock.calls[0]?.[0] as HTMLElement);
    hydrateEmbedPreviews(root);

    expect(root.querySelector("iframe")).toHaveAttribute(
      "src",
      `https://app.vidcast.io/playlists/embed/${PLAYLIST_ID}?expand=1`,
    );
    expect(root.querySelector("iframe")).toHaveAttribute("title", "Vidcast playlist");
    expect(root.querySelector(".tome-embed-link")).toHaveAttribute(
      "href",
      `https://app.vidcast.io/playlists/${PLAYLIST_ID}`,
    );
    expect(root.querySelector(".tome-embed-link")).toHaveTextContent(
      "Open playlist on Vidcast",
    );
    expect(root.querySelector(".tome-vidcast-playlist-toggle")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(root.querySelector(".tome-vidcast-playlist-toggle")).toHaveAccessibleName(
      "Show playlist videos",
    );
  });

  it("renders a collapsed Vidcast playlist toggle from its persisted URL", () => {
    const applyPreview = jest.fn();

    renderTomeCodePreview(
      "vidcast",
      `url: https://app.vidcast.io/playlists/${PLAYLIST_ID}?expand=0`,
      applyPreview,
    );
    const root = document.createElement("div");
    root.append(applyPreview.mock.calls[0]?.[0] as HTMLElement);

    expect(root.querySelector(".tome-vidcast-playlist-toggle")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("renders YouTube through the privacy-enhanced player", () => {
    const applyPreview = jest.fn();

    renderTomeCodePreview(
      "youtube",
      [
        "url: https://www.youtube.com/watch?v=M7lc1UVf-VE&t=30",
        "title: YouTube example",
      ].join("\n"),
      applyPreview,
    );
    const root = document.createElement("div");
    root.append(applyPreview.mock.calls[0]?.[0] as HTMLElement);
    hydrateEmbedPreviews(root);

    const iframe = root.querySelector("iframe");
    expect(iframe).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?start=30",
    );
    expect(iframe).toHaveAttribute("title", "YouTube example");
    expect(iframe).toHaveAttribute("allowfullscreen");
    expect(iframe?.getAttribute("allow")).toContain("encrypted-media");
    expect(root.querySelector(".tome-embed-link")).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=M7lc1UVf-VE&t=30",
    );
  });

  it("renders a persisted video width with an accessible resize handle", () => {
    const applyPreview = jest.fn();

    renderTomeCodePreview(
      "youtube",
      [`url: https://youtu.be/M7lc1UVf-VE`, "width: 60%"].join("\n"),
      applyPreview,
    );
    const root = document.createElement("div");
    root.append(applyPreview.mock.calls[0]?.[0] as HTMLElement);
    hydrateEmbedPreviews(root);

    const preview = root.querySelector<HTMLElement>(".tome-embed-preview");
    const handle = root.querySelector(".tome-media-resize");
    expect(preview).toHaveStyle("--tome-media-width: 60%");
    expect(handle).toHaveAccessibleName("Resize YouTube embed");
    expect(handle).toHaveAttribute("role", "slider");
    expect(handle).toHaveAttribute("aria-valuenow", "60");
    expect(root.querySelector("iframe")).not.toBeNull();
  });

  it("renders an accessible alignment control for persisted media alignment", () => {
    const applyPreview = jest.fn();

    renderTomeCodePreview(
      "youtube",
      [`url: https://youtu.be/M7lc1UVf-VE`, "width: 60%", "align: right"].join("\n"),
      applyPreview,
    );
    const root = document.createElement("div");
    root.append(applyPreview.mock.calls[0]?.[0] as HTMLElement);

    const preview = root.querySelector<HTMLElement>(".tome-embed-preview");
    expect(preview).toHaveAttribute("data-media-align", "right");
    expect(root.querySelector(".tome-media-alignment")).toHaveAccessibleName(
      "Media alignment",
    );
    expect(
      root.querySelector('button.tome-media-align[data-align="right"]'),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      root.querySelector('button.tome-media-align[data-align="left"]'),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("renders arXiv papers with the sandboxed HTML reader", () => {
    const applyPreview = jest.fn();

    renderTomeCodePreview(
      "arxiv",
      ["url: https://arxiv.org/abs/1706.03762", "title: Example paper"].join("\n"),
      applyPreview,
    );
    const root = document.createElement("div");
    root.append(applyPreview.mock.calls[0]?.[0] as HTMLElement);
    hydrateEmbedPreviews(root);

    const iframe = root.querySelector("iframe");
    expect(iframe).toHaveAttribute("src", "https://arxiv.org/html/1706.03762");
    expect(iframe).toHaveAttribute("title", "Example paper");
    expect(iframe).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-presentation",
    );
    expect(iframe).not.toHaveAttribute("allow");
    expect(root.querySelector(".tome-embed-link")).toHaveAttribute(
      "href",
      "https://arxiv.org/abs/1706.03762",
    );
  });

  it("turns pasted images into persistent data URLs", async () => {
    const file = new File(["image bytes"], "diagram.png", { type: "image/png" });

    await expect(imageFileToDataUrl(file)).resolves.toBe(
      "data:image/png;base64,aW1hZ2UgYnl0ZXM=",
    );
  });

  it("rejects images that would make page revisions unsafe", async () => {
    const file = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png", {
      type: "image/png",
    });

    await expect(imageFileToDataUrl(file)).rejects.toThrow("2 MB or smaller");
  });

  it("rejects non-image uploads", async () => {
    const file = new File(["plain text"], "notes.txt", { type: "text/plain" });

    await expect(imageFileToDataUrl(file)).rejects.toThrow(
      "Only image files can be embedded",
    );
  });
});
