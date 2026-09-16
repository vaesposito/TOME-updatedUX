import {
  excalidrawFileToMarkdown,
  parseExcalidrawDocument,
  serializeExcalidrawBlock,
} from "../excalidraw";

const validDocument = (text = "Example") =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "https://example.com",
    elements: [
      {
        id: "text-1",
        type: "text",
        x: 10,
        y: 20,
        width: 120,
        height: 30,
        text,
      },
    ],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  });

describe("Excalidraw documents", () => {
  it("validates and serializes an Excalidraw scene as Markdown JSON", () => {
    const block = serializeExcalidrawBlock(validDocument());

    expect(block).toMatch(/^```excalidraw\n/);
    expect(block).toContain('"type": "excalidraw"');
    expect(block).toContain('"text": "Example"');
    expect(block).toMatch(/\n```$/);
  });

  it("uses a longer Markdown fence when drawing text contains backticks", () => {
    const block = serializeExcalidrawBlock(validDocument("Use ``` for a code fence"));

    expect(block).toMatch(/^````excalidraw\n/);
    expect(block).toMatch(/\n````$/);
  });

  it("accepts safe embedded raster images", () => {
    const document = JSON.parse(validDocument());
    document.files = {
      "image-1": {
        id: "image-1",
        mimeType: "image/png",
        dataURL: "data:image/png;base64,iVBORw0KGgo=",
      },
    };

    expect(parseExcalidrawDocument(JSON.stringify(document)).files).toEqual(
      document.files,
    );
  });

  it.each([
    ["invalid JSON", "{", /valid JSON/i],
    ["wrong type", JSON.stringify({ type: "diagram", version: 2, elements: [] }), /type/i],
    ["missing elements", JSON.stringify({ type: "excalidraw", version: 2 }), /elements/i],
  ])("rejects %s", (_label, content, expected) => {
    expect(() => parseExcalidrawDocument(content)).toThrow(expected);
  });

  it("rejects SVG image payloads instead of importing active image content", () => {
    const document = JSON.parse(validDocument());
    document.files = {
      "image-1": {
        id: "image-1",
        mimeType: "image/svg+xml",
        dataURL: "data:image/svg+xml;base64,PHN2Zy8+",
      },
    };

    expect(() => parseExcalidrawDocument(JSON.stringify(document))).toThrow(
      /PNG, JPEG, WebP, or GIF/i,
    );
  });

  it("rejects malformed or unbounded drawing points", () => {
    const document = JSON.parse(validDocument());
    document.elements[0].points = [[0, 0], [Number.MAX_SAFE_INTEGER, 1]];

    expect(() => parseExcalidrawDocument(JSON.stringify(document))).toThrow(
      /supported drawing bounds/i,
    );

    document.elements[0].points = [[0]];
    expect(() => parseExcalidrawDocument(JSON.stringify(document))).toThrow(
      /must contain x and y/i,
    );
  });

  it("uploads only .excalidraw files", async () => {
    const file = new File([validDocument()], "architecture.excalidraw", {
      type: "application/json",
    });

    await expect(excalidrawFileToMarkdown(file)).resolves.toContain(
      "```excalidraw",
    );
    await expect(
      excalidrawFileToMarkdown(
        new File([validDocument()], "architecture.json", {
          type: "application/json",
        }),
      ),
    ).rejects.toThrow(/\.excalidraw/i);
  });
});
