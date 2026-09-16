const MAX_EXCALIDRAW_BYTES = 5 * 1024 * 1024;
const MAX_EXCALIDRAW_ELEMENTS = 2_000;
const MAX_EXCALIDRAW_FILES = 100;
const MAX_EXCALIDRAW_POINTS = 50_000;
const MAX_EXCALIDRAW_COORDINATE = 1_000_000;
const UNSAFE_INTERACTIVE_ELEMENT_TYPES = new Set(["embeddable", "iframe"]);
const SAFE_EMBEDDED_IMAGE_PREFIX = /^data:image\/(?:png|jpeg|webp|gif);base64,/i;

export type ExcalidrawDocument = {
  type: "excalidraw";
  version: number;
  source?: string;
  elements: Array<Record<string, unknown>>;
  appState?: Record<string, unknown>;
  files?: Record<string, Record<string, unknown>>;
};

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
}

function assertBoundedNumber(value: unknown, label: string): void {
  if (value === undefined) return;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > MAX_EXCALIDRAW_COORDINATE
  ) {
    throw new Error(`${label} is outside the supported drawing bounds.`);
  }
}

export function parseExcalidrawDocument(content: string): ExcalidrawDocument {
  if (!content.trim()) throw new Error("The Excalidraw document is empty.");
  if (byteLength(content) > MAX_EXCALIDRAW_BYTES) {
    throw new Error("Excalidraw documents must be 5 MB or smaller.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("The file does not contain valid JSON.");
  }
  assertPlainObject(parsed, "The Excalidraw document");
  if (parsed.type !== "excalidraw") {
    throw new Error('The JSON type must be "excalidraw".');
  }
  if (typeof parsed.version !== "number" || !Number.isFinite(parsed.version)) {
    throw new Error("The Excalidraw document must include a numeric version.");
  }
  if (!Array.isArray(parsed.elements)) {
    throw new Error("The Excalidraw document must include an elements array.");
  }
  if (parsed.elements.length > MAX_EXCALIDRAW_ELEMENTS) {
    throw new Error(`Excalidraw documents may contain at most ${MAX_EXCALIDRAW_ELEMENTS} elements.`);
  }

  let pointCount = 0;
  const elements = parsed.elements.map((element, index) => {
    assertPlainObject(element, `Element ${index + 1}`);
    if (typeof element.id !== "string" || !element.id.trim()) {
      throw new Error(`Element ${index + 1} must include an id.`);
    }
    if (typeof element.type !== "string" || !element.type.trim()) {
      throw new Error(`Element ${index + 1} must include a type.`);
    }
    for (const key of ["x", "y", "width", "height"] as const) {
      assertBoundedNumber(element[key], `Element ${index + 1} ${key}`);
    }
    if (element.points !== undefined) {
      if (!Array.isArray(element.points)) {
        throw new Error(`Element ${index + 1} points must be an array.`);
      }
      pointCount += element.points.length;
      if (pointCount > MAX_EXCALIDRAW_POINTS) {
        throw new Error(
          `Excalidraw documents may contain at most ${MAX_EXCALIDRAW_POINTS} points.`,
        );
      }
      for (const [pointIndex, point] of element.points.entries()) {
        if (!Array.isArray(point) || point.length < 2) {
          throw new Error(
            `Element ${index + 1} point ${pointIndex + 1} must contain x and y coordinates.`,
          );
        }
        assertBoundedNumber(
          point[0],
          `Element ${index + 1} point ${pointIndex + 1} x`,
        );
        assertBoundedNumber(
          point[1],
          `Element ${index + 1} point ${pointIndex + 1} y`,
        );
      }
    }
    return element;
  });

  if (parsed.appState !== undefined && parsed.appState !== null) {
    assertPlainObject(parsed.appState, "appState");
  }
  if (parsed.files !== undefined && parsed.files !== null) {
    assertPlainObject(parsed.files, "files");
    const files = Object.entries(parsed.files);
    if (files.length > MAX_EXCALIDRAW_FILES) {
      throw new Error(`Excalidraw documents may contain at most ${MAX_EXCALIDRAW_FILES} files.`);
    }
    for (const [fileId, file] of files) {
      assertPlainObject(file, `Embedded file ${fileId}`);
      if (typeof file.dataURL !== "string" || !SAFE_EMBEDDED_IMAGE_PREFIX.test(file.dataURL)) {
        throw new Error(
          `Embedded file ${fileId} must be a PNG, JPEG, WebP, or GIF data URL.`,
        );
      }
    }
  }

  return {
    type: "excalidraw",
    version: parsed.version,
    ...(typeof parsed.source === "string" ? { source: parsed.source } : {}),
    elements,
    ...(parsed.appState && typeof parsed.appState === "object"
      ? { appState: parsed.appState as Record<string, unknown> }
      : {}),
    ...(parsed.files && typeof parsed.files === "object"
      ? { files: parsed.files as Record<string, Record<string, unknown>> }
      : {}),
  };
}

function markdownFenceFor(content: string): string {
  const longestBacktickRun = Math.max(
    0,
    ...Array.from(content.matchAll(/`+/g), (match) => match[0].length),
  );
  return "`".repeat(Math.max(3, longestBacktickRun + 1));
}

export function serializeExcalidrawBlock(content: string): string {
  const document = parseExcalidrawDocument(content);
  const json = JSON.stringify(document, null, 2);
  const fence = markdownFenceFor(json);
  return `${fence}excalidraw\n${json}\n${fence}`;
}

export async function excalidrawFileToMarkdown(file: File): Promise<string> {
  if (!file.name.toLowerCase().endsWith(".excalidraw")) {
    throw new Error("Choose a .excalidraw file.");
  }
  if (file.size > MAX_EXCALIDRAW_BYTES) {
    throw new Error("Excalidraw documents must be 5 MB or smaller.");
  }
  const content =
    typeof file.text === "function"
      ? await file.text()
      : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
          reader.addEventListener("error", () =>
            reject(reader.error ?? new Error("The Excalidraw file could not be read.")),
          );
          reader.readAsText(file);
        });
  return serializeExcalidrawBlock(content);
}

function usesDarkTheme(theme?: string): boolean {
  const currentTheme =
    theme ??
    (typeof document === "undefined"
      ? undefined
      : document.documentElement.getAttribute("data-theme") ?? undefined);
  return currentTheme !== "light" && currentTheme !== "legacy-light";
}

export async function renderExcalidrawSvg(content: string, theme?: string): Promise<string> {
  const scene = parseExcalidrawDocument(content);
  const { exportToSvg } = await import("@excalidraw/utils");
  const elements = scene.elements
    .filter(
      (element) =>
        element.isDeleted !== true &&
        !UNSAFE_INTERACTIVE_ELEMENT_TYPES.has(String(element.type)),
    )
    // The preview is a drawing, not an interactive document. Do not carry
    // user-authored links into the generated SVG.
    .map((element) => ({ ...element, link: null }));
  if (elements.length === 0) {
    throw new Error("The Excalidraw document has no visible drawing elements.");
  }

  const dark = usesDarkTheme(theme);
  const svg = await exportToSvg({
    data: {
      elements: elements as never,
      files: (scene.files ?? null) as never,
      appState: {
        ...scene.appState,
        exportBackground: true,
        exportWithDarkMode: dark,
        viewBackgroundColor:
          typeof scene.appState?.viewBackgroundColor === "string"
            ? scene.appState.viewBackgroundColor
            : "#ffffff",
      },
    },
    config: {
      theme: dark ? "dark" : "light",
      padding: 20,
      canvasBackgroundColor: undefined,
      exportingFrame: null,
      renderEmbeddables: false,
      // Tome renders the exported SVG as a static preview. Avoid external font
      // fetches and let the browser use its local fallback when Virgil is absent.
      skipInliningFonts: true,
    },
  });
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Excalidraw drawing");
  return svg.outerHTML;
}
