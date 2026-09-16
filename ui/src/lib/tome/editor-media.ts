import {
  MAX_EMBED_WIDTH_PERCENT,
  MIN_EMBED_WIDTH_PERCENT,
  parseTomeEmbed,
  type TomeEmbed,
  type TomeMediaAlignment,
} from "@/lib/tome/embeds";

const MAX_EMBEDDED_IMAGE_BYTES = 2 * 1024 * 1024;

let mermaidRenderId = 0;

const LIGHT_TOME_THEMES = new Set(["light", "legacy-light"]);

function mermaidTheme(theme?: string): "default" | "dark" {
  const currentTheme =
    theme ??
    (typeof document === "undefined"
      ? undefined
      : document.documentElement.getAttribute("data-theme") ?? undefined);
  return currentTheme && LIGHT_TOME_THEMES.has(currentTheme) ? "default" : "dark";
}

function mermaidPreviewMarkup(svg: string): string {
  return [
    '<div class="tome-mermaid-preview">',
    '<button type="button" class="tome-mermaid-expand" aria-label="Expand Mermaid diagram" title="Expand diagram">',
    '<span aria-hidden="true">⛶</span>',
    "<span>Expand</span>",
    "</button>",
    '<div class="tome-mermaid-canvas">',
    svg,
    "</div>",
    "</div>",
  ].join("");
}

function createMermaidError(error: unknown, source: string): HTMLElement {
  const message = error instanceof Error ? error.message : "Invalid Mermaid diagram";
  const lineMatch = message.match(/\bline\s+(\d+)\b/i);
  const lineNumber = lineMatch ? Number.parseInt(lineMatch[1], 10) : null;
  const syntaxKind = message.match(/\b(lexical|parse|syntax)\s+error\b/i)?.[1];
  const isSyntaxError = Boolean(syntaxKind || lineNumber);
  const node = document.createElement("div");
  node.className = "tome-mermaid-error";
  node.setAttribute("role", "alert");

  const title = document.createElement("p");
  title.className = "tome-mermaid-error-title";
  title.textContent = isSyntaxError
    ? "Mermaid syntax error"
    : "Could not render Mermaid diagram";
  node.append(title);

  const summary = document.createElement("p");
  summary.className = "tome-mermaid-error-summary";
  if (isSyntaxError) {
    const firstLine = message.split(/\r?\n/, 1)[0].trim();
    const description = firstLine
      .replace(/^(?:lexical|parse|syntax)\s+error(?:\s+on\s+line\s+\d+)?[.:]?\s*/i, "")
      .trim();
    const kind = syntaxKind
      ? `${syntaxKind[0].toUpperCase()}${syntaxKind.slice(1).toLowerCase()} error`
      : "Mermaid could not parse this diagram";
    summary.textContent = [lineNumber ? `Line ${lineNumber}` : null, kind, description]
      .filter(Boolean)
      .join(" · ");
  } else {
    summary.textContent = "Mermaid could not render this diagram.";
  }
  node.append(summary);

  if (lineNumber) {
    const sourceLine = source.split(/\r?\n/)[lineNumber - 1];
    if (sourceLine !== undefined) {
      const excerpt = document.createElement("pre");
      excerpt.className = "tome-mermaid-error-excerpt";
      const code = document.createElement("code");
      code.textContent = `${lineNumber} | ${sourceLine}`;
      excerpt.append(code);
      node.append(excerpt);
    }
  }

  const hint = document.createElement("p");
  hint.className = "tome-mermaid-error-hint";
  hint.textContent = isSyntaxError
    ? "Check brackets, quotes, arrows, and diagram keywords, then preview again."
    : "Try editing the Mermaid source and previewing again.";
  node.append(hint);

  const details = document.createElement("details");
  details.className = "tome-mermaid-error-details";
  const detailsLabel = document.createElement("summary");
  detailsLabel.textContent = "Technical details";
  const diagnostic = document.createElement("pre");
  diagnostic.textContent = message;
  details.append(detailsLabel, diagnostic);
  node.append(details);

  return node;
}

function embedToolbarMarkup(embed: TomeEmbed): string {
  const label = embedProviderLabel(embed.provider);
  const playlistExpanded =
    embed.provider === "vidcast" && embed.src.includes("/playlists/embed/")
      ? new URL(embed.src).searchParams.get("expand") !== "0"
      : null;
  return [
    '<div class="tome-embed-toolbar">',
    mediaAlignmentControlsMarkup(embed.alignment),
    playlistExpanded !== null
      ? [
          '<button type="button" class="tome-vidcast-playlist-toggle" role="switch"',
          ` aria-checked="${playlistExpanded}" aria-label="Show playlist videos">`,
          '<span class="tome-vidcast-playlist-toggle-track" aria-hidden="true"><span></span></span>',
          "<span>Show playlist videos</span>",
          "</button>",
        ].join("")
      : "",
    `<button type="button" class="tome-embed-remove" aria-label="Remove ${label} embed">`,
    '<span aria-hidden="true">✕</span>',
    "<span>Remove embed</span>",
    "</button>",
    "</div>",
  ].join("");
}

function alignmentIconMarkup(alignment: TomeMediaAlignment): string {
  const widths = alignment === "center" ? [14, 20, 14] : [20, 14, 18];
  const lines = widths.map((width, index) => {
    const x = alignment === "left" ? 2 : alignment === "right" ? 22 - width : 12 - width / 2;
    const y = 5 + index * 7;
    return `<path d="M${x} ${y}h${width}"/>`;
  });
  return [
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"',
    ' stroke-linecap="round" aria-hidden="true">',
    ...lines,
    "</svg>",
  ].join("");
}

export function mediaAlignmentControlsMarkup(alignment: TomeMediaAlignment): string {
  return [
    '<div class="tome-media-alignment" role="group" aria-label="Media alignment">',
    ...(["left", "center", "right"] as const).map(
      (option) =>
        `<button type="button" class="tome-media-align" data-align="${option}"` +
        ` aria-label="Align media ${option}" aria-pressed="${alignment === option}"` +
        ` title="Align ${option}">${alignmentIconMarkup(option)}</button>`,
    ),
    "</div>",
  ].join("");
}

function mediaResizeHandleMarkup(label: string, widthPercent: number): string {
  return [
    `<button type="button" class="tome-media-resize" aria-label="Resize ${label}"`,
    ` title="Drag to resize ${label}; use arrow keys for precise sizing"`,
    ` role="slider" aria-valuemin="${MIN_EMBED_WIDTH_PERCENT}" aria-valuemax="${MAX_EMBED_WIDTH_PERCENT}" aria-valuenow="${widthPercent}">`,
    '<span class="tome-media-size-label" aria-hidden="true">',
    `${widthPercent}%`,
    "</span>",
    '<span class="tome-media-resize-icon" aria-hidden="true">↘</span>',
    "</button>",
  ].join("");
}

function embedProviderLabel(provider: string): string {
  if (provider === "arxiv") return "arXiv";
  if (provider === "youtube") return "YouTube";
  if (provider === "vidcast") return "Vidcast";
  if (provider === "pdf") return "PDF";
  return provider;
}

export function createEmbedPreview(
  embed: TomeEmbed,
  authoringControls = true,
): HTMLElement {
  const node = document.createElement("div");
  node.className = `tome-embed-preview tome-${embed.provider}-preview`;
  node.dataset.embedProvider = embed.provider;
  node.dataset.embedSrc = embed.src;
  node.dataset.embedTitle = embed.title;
  node.dataset.mediaAlign = embed.alignment;
  const widthPercent = embed.widthPercent ?? 100;
  node.dataset.embedWidth = String(widthPercent);
  node.style.setProperty("--tome-media-width", `${widthPercent}%`);
  const frame = document.createElement("div");
  frame.className = `tome-embed-frame tome-${embed.kind}-frame`;
  const fallback = document.createElement("a");
  fallback.className = "tome-embed-link";
  fallback.href = embed.watchUrl;
  fallback.target = "_blank";
  fallback.rel = "noopener noreferrer";
  fallback.textContent = `${embed.linkLabel}: ${embed.title}`;
  if (authoringControls) {
    node.insertAdjacentHTML("beforeend", embedToolbarMarkup(embed));
  }
  if (authoringControls && embed.kind === "video") {
    frame.insertAdjacentHTML(
      "beforeend",
      mediaResizeHandleMarkup(`${embedProviderLabel(embed.provider)} embed`, widthPercent),
    );
  }
  node.append(frame, fallback);
  return node;
}

export function createEmbedError(
  provider: string,
  message: string,
  authoringControls = true,
): HTMLElement {
  const node = document.createElement("div");
  node.className = `tome-embed-error tome-${provider}-error`;
  node.setAttribute("role", "alert");
  if (authoringControls) {
    node.insertAdjacentHTML(
      "beforeend",
      [
        '<div class="tome-embed-toolbar">',
        `<button type="button" class="tome-embed-remove" aria-label="Remove ${embedProviderLabel(provider)} embed">`,
        '<span aria-hidden="true">✕</span><span>Remove embed</span></button></div>',
      ].join(""),
    );
  }
  const text = document.createElement("span");
  text.textContent = message;
  node.append(text);
  return node;
}

/**
 * Render Mermaid fenced code blocks through Crepe's async preview hook.
 * Returning null leaves every other fenced language as a normal code block.
 */
export function renderTomeCodePreview(
  language: string,
  content: string,
  applyPreview: (value: null | string | HTMLElement) => void,
  theme?: string,
): null | void {
  const normalizedLanguage = language.trim().toLowerCase();
  const embed = parseTomeEmbed(normalizedLanguage, content);
  if (embed) {
    const providerLabel = embedProviderLabel(normalizedLanguage);
    if (embed.ok === false) {
      applyPreview(
        createEmbedError(
          normalizedLanguage,
          `Could not embed ${providerLabel}: ${embed.error}`,
        ),
      );
      return;
    }

    // Crepe sanitizes all preview markup and deliberately removes iframes.
    // Emit inert data here; CrepeEditor re-validates it and creates the iframe
    // after the sanitizer has completed.
    applyPreview(createEmbedPreview(embed.value));
    return;
  }

  if (normalizedLanguage !== "mermaid" || !content.trim()) return null;

  const renderId = `tome-mermaid-${mermaidRenderId++}`;
  void import("mermaid")
    .then(async ({ default: mermaid }) => {
      // Mermaid emits concrete colors into its SVG. Initialize for every
      // render so diagrams created after a theme change use the active CAIPE
      // palette instead of retaining the first theme seen by the module.
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: mermaidTheme(theme),
      });
      const { svg } = await mermaid.render(renderId, content);
      applyPreview(mermaidPreviewMarkup(svg));
    })
    .catch((error: unknown) => {
      // Mermaid appends a temporary `d<renderId>` container to <body>. On a
      // parser failure it leaves its own large error SVG behind, outside the
      // editor/reader that requested the preview. Remove only that render's
      // temporary node and show our scoped, text-only error instead.
      document.getElementById(`d${renderId}`)?.remove();
      applyPreview(createMermaidError(error, content));
    });
}

/** Create validated external iframes inside sanitized Crepe placeholders. */
export function hydrateEmbedPreviews(root: ParentNode): void {
  root
    .querySelectorAll<HTMLElement>(
      ".tome-embed-preview:not([data-embed-hydrated])",
    )
    .forEach((preview) => {
      preview.dataset.embedHydrated = "true";
      const provider = preview.dataset.embedProvider ?? "";
      const parsed = parseTomeEmbed(
        provider,
        [
          `url: ${preview.dataset.embedSrc ?? ""}`,
          `title: ${preview.dataset.embedTitle ?? "Embedded content"}`,
          preview.dataset.embedWidth ? `width: ${preview.dataset.embedWidth}%` : "",
          preview.dataset.mediaAlign ? `align: ${preview.dataset.mediaAlign}` : "",
        ].join("\n"),
      );
      const frame = preview.querySelector<HTMLElement>(".tome-embed-frame");
      if (!parsed || !parsed.ok || !frame) {
        preview.classList.add("tome-embed-error");
        preview.setAttribute("role", "alert");
        preview.textContent = "The external embed could not be loaded safely.";
        return;
      }

      const widthPercent = parsed.value.widthPercent ?? 100;
      preview.dataset.embedWidth = String(widthPercent);
      preview.style.setProperty("--tome-media-width", `${widthPercent}%`);
      preview.dataset.mediaAlign = parsed.value.alignment;

      const iframe = document.createElement("iframe");
      iframe.className = `tome-embed-iframe tome-${parsed.value.provider}-iframe`;
      iframe.src = parsed.value.src;
      iframe.title = parsed.value.title;
      iframe.setAttribute("loading", "lazy");
      iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
      if (parsed.value.provider === "youtube") {
        iframe.setAttribute(
          "allow",
          "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
        );
        iframe.setAttribute("allowfullscreen", "");
      } else if (parsed.value.provider === "vidcast") {
        iframe.setAttribute("allow", "fullscreen; autoplay; clipboard-write");
        iframe.setAttribute("allowfullscreen", "");
      }
      iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      const resizeHandle = frame.querySelector<HTMLElement>(".tome-media-resize");
      frame.replaceChildren(iframe);
      if (resizeHandle) frame.append(resizeHandle);
    });
}

/**
 * Crepe defaults pasted images to temporary `blob:` URLs. Embed small images
 * in the Markdown instead so saved wiki revisions remain self-contained.
 */
export function imageFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("Only image files can be embedded."));
  }
  if (file.size > MAX_EMBEDDED_IMAGE_BYTES) {
    return Promise.reject(
      new Error("Images must be 2 MB or smaller so the wiki page can be saved safely."),
    );
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The image could not be read."));
    };
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
}
