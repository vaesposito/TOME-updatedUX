import { readFile } from "node:fs/promises";
import path from "node:path";
import pptxgen from "pptxgenjs";

import type {
  PresentationBullet,
  PresentationDeck,
  PresentationSlide,
  PresentationVisual,
  PresentationVisualGroup,
} from "@/lib/tome/presentation";
import { presentationSourceRefs, presentationSourceUrl } from "@/lib/tome/presentation";

const COLORS = {
  ink: "071726",
  surface: "0D2033",
  panel: "12314E",
  panelTwo: "0F2841",
  line: "35556F",
  text: "E9F1F7",
  muted: "9CB5CA",
  cyan: "3CB8EA",
  blue: "0051AF",
  green: "74BF4B",
  orange: "FF6D2D",
  amber: "F0A93B",
  coral: "EE7F72",
  white: "FFFFFF",
  generated: "F0A93B",
};

const TEMPLATE_ASSET_ROOT = path.join(process.cwd(), "public", "tome", "presentation");

interface OutshiftAssets {
  grid: string;
  logo: string;
  logoReversed: string;
}

async function loadOutshiftAssets(): Promise<OutshiftAssets> {
  const [grid, logo, logoReversed] = await Promise.all([
    readFile(path.join(TEMPLATE_ASSET_ROOT, "outshift-grid.png")),
    readFile(path.join(TEMPLATE_ASSET_ROOT, "outshift-logo.png")),
    readFile(path.join(TEMPLATE_ASSET_ROOT, "outshift-logo-reversed.png")),
  ]);
  return {
    grid: `data:image/png;base64,${grid.toString("base64")}`,
    logo: `data:image/png;base64,${logo.toString("base64")}`,
    logoReversed: `data:image/png;base64,${logoReversed.toString("base64")}`,
  };
}

type PptxSlide = ReturnType<InstanceType<typeof pptxgen>["addSlide"]>;

interface PhysicalSlide {
  content: PresentationSlide;
  bullets: PresentationBullet[];
  showVisual: boolean;
  continuation: boolean;
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "presentation";
}

export function presentationFilename(slug: string, title: string): string {
  return `${safeFilename(slug)}-${safeFilename(title)}.pptx`;
}

function estimatedLineCount(text: string, width: number): number {
  const charactersPerLine = Math.max(30, Math.floor(width * 9.5));
  const words = text.split(/\s+/);
  let lines = 1;
  let current = 0;
  words.forEach((word) => {
    if (current > 0 && current + word.length + 1 > charactersPerLine) {
      lines += 1;
      current = word.length;
    } else {
      current += word.length + (current > 0 ? 1 : 0);
    }
  });
  return Math.max(1, lines);
}

function estimatedBulletHeight(bullet: PresentationBullet, width: number): number {
  const markerLength = bullet.source_refs.length > 0 ? 8 : 3;
  return Math.max(0.48, estimatedLineCount(`${bullet.text}${" ".repeat(markerLength)}`, width) * 0.29 + 0.12);
}

function paginateSlide(content: PresentationSlide, cover = false): PhysicalSlide[] {
  if (content.bullets.length === 0) {
    return [{ content, bullets: [], showVisual: Boolean(content.visual), continuation: false }];
  }
  const pages: PhysicalSlide[] = [];
  let start = 0;
  while (start < content.bullets.length) {
    const showVisual = pages.length === 0 && Boolean(content.visual);
    const textWidth = showVisual ? 7.15 : 11.35;
    const availableHeight = cover ? 2.75 : 4.55;
    let usedHeight = 0;
    let end = start;
    while (end < content.bullets.length) {
      const bulletHeight = estimatedBulletHeight(content.bullets[end], textWidth);
      const nextHeight = usedHeight + bulletHeight + (end > start ? 0.1 : 0);
      if (end > start && nextHeight > availableHeight) break;
      usedHeight = nextHeight;
      end += 1;
    }
    pages.push({
      content,
      bullets: content.bullets.slice(start, end),
      showVisual,
      continuation: pages.length > 0,
    });
    start = end;
  }
  return pages;
}

function quotedLabels(value: string): string[] {
  const labels = [...value.matchAll(/[\u0022\u0027\u2018\u201c]([^\u0022\u0027\u2019\u201d]{2,100})[\u0022\u0027\u2019\u201d]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  return [...new Set(labels)];
}

function legacyVisualGroups(visual: PresentationVisual): PresentationVisualGroup[] {
  const groups: PresentationVisualGroup[] = [];
  const lanePattern = /(?:lane|layer)\s+\d+\s+[\u0027\u2018\u201c]([^\u0027\u2019\u201d]+)[\u0027\u2019\u201d]\s*:\s*([\s\S]*?)(?=(?:lane|layer)\s+\d+\s+[\u0027\u2018\u201c]|connecting arrows?\s*:|$)/gi;
  for (const match of visual.description.matchAll(lanePattern)) {
    groups.push({ label: match[1].trim(), items: quotedLabels(match[2]).slice(0, 6) });
  }
  if (groups.length > 0) return groups.slice(0, 6);
  const labels = quotedLabels(visual.description).slice(0, 16);
  const groupSize = visual.layout === "grid" ? 4 : Math.min(4, labels.length);
  for (let index = 0; index < labels.length; index += groupSize) {
    groups.push({ label: "", items: labels.slice(index, index + groupSize) });
  }
  return groups.slice(0, 6);
}

function visualLayout(visual: PresentationVisual): PresentationVisual["layout"] {
  if (visual.groups.length > 0) return visual.layout;
  if (/(?:layered|swim\s*lanes?|lane\s+\d+)/i.test(visual.description)) return "layers";
  if (/(?:quadrant|2\s*[x×]\s*2|table)/i.test(visual.description)) return "grid";
  if (/timeline/i.test(visual.description)) return "timeline";
  return visual.layout;
}

function addVisualHeader(slide: PptxSlide, visual: PresentationVisual, x: number, y: number, width: number): void {
  slide.addText(visual.kind === "diagram" ? "DIAGRAM" : "GRAPHIC", {
    x,
    y,
    w: 1.05,
    h: 0.2,
    fontSize: 9,
    bold: true,
    charSpacing: 1.1,
    color: visual.kind === "graphic" ? COLORS.amber : COLORS.cyan,
    margin: 0,
  });
  if (visual.title) {
    slide.addText(visual.title, {
      x: x + 1.08,
      y: y - 0.02,
      w: width - 1.08,
      h: 0.25,
      fontSize: 13,
      bold: true,
      align: "right",
      color: COLORS.text,
      margin: 0,
      fit: "shrink",
    });
  }
}

function drawStackVisual(
  slide: PptxSlide,
  pptx: InstanceType<typeof pptxgen>,
  visual: PresentationVisual,
  groups: PresentationVisualGroup[],
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const count = Math.max(groups.length, 1);
  const gap = 0.11;
  const groupHeight = Math.min(0.82, (height - gap * (count - 1)) / count);
  const totalHeight = groupHeight * count + gap * (count - 1);
  const startY = y + Math.max(0, (height - totalHeight) / 2);
  groups.slice(0, 6).forEach((_, index) => {
    if (index === groups.length - 1) return;
    const arrowY = startY + (index + 1) * groupHeight + index * gap;
    slide.addShape(pptx.ShapeType.line, {
      x: x + width / 2,
      y: arrowY - 0.02,
      w: 0,
      h: gap + 0.04,
      line: { color: COLORS.cyan, width: 1.2, endArrowType: "triangle" },
    });
  });
  groups.slice(0, 6).forEach((group, index) => {
    const groupY = startY + index * (groupHeight + gap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y: groupY,
      w: width,
      h: groupHeight,
      rectRadius: 0.04,
      line: { color: visual.kind === "graphic" ? COLORS.amber : COLORS.cyan, transparency: 35, width: 1 },
      fill: { color: COLORS.panelTwo, transparency: 5 },
    });
    const labelWidth = group.label ? Math.min(1.3, width * 0.32) : 0;
    if (group.label) {
      slide.addText(group.label, {
        x: x + 0.12,
        y: groupY + 0.08,
        w: labelWidth - 0.16,
        h: groupHeight - 0.16,
        fontSize: 10.5,
        bold: true,
        color: visual.kind === "graphic" ? COLORS.amber : COLORS.cyan,
        margin: 0,
        valign: "middle",
        fit: "shrink",
      });
    }
    slide.addText(group.items.slice(0, 6).join("  •  ") || group.label, {
      x: x + labelWidth + 0.12,
      y: groupY + 0.08,
      w: width - labelWidth - 0.24,
      h: groupHeight - 0.16,
      fontSize: 11.5,
      color: COLORS.text,
      margin: 0,
      valign: "middle",
      fit: "shrink",
    });
  });
}

function drawGridVisual(
  slide: PptxSlide,
  visual: PresentationVisual,
  groups: PresentationVisualGroup[],
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const visibleGroups = groups.slice(0, 4);
  const columns = visibleGroups.length > 1 ? 2 : 1;
  const rows = Math.ceil(visibleGroups.length / columns);
  const gap = 0.12;
  const cardWidth = (width - gap * (columns - 1)) / columns;
  const cardHeight = (height - gap * (rows - 1)) / Math.max(rows, 1);
  visibleGroups.forEach((group, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cardX = x + column * (cardWidth + gap);
    const cardY = y + row * (cardHeight + gap);
    slide.addShape("roundRect", {
      x: cardX,
      y: cardY,
      w: cardWidth,
      h: cardHeight,
      rectRadius: 0.04,
      line: { color: visual.kind === "graphic" ? COLORS.amber : COLORS.cyan, transparency: 35, width: 1 },
      fill: { color: COLORS.panelTwo, transparency: 5 },
    });
    if (group.label) {
      slide.addText(group.label, {
        x: cardX + 0.12,
        y: cardY + 0.1,
        w: cardWidth - 0.24,
        h: 0.28,
        fontSize: 11,
        bold: true,
        color: visual.kind === "graphic" ? COLORS.amber : COLORS.cyan,
        margin: 0,
        fit: "shrink",
      });
    }
    slide.addText(group.items.slice(0, 5).map((item) => `• ${item}`).join("\n") || group.label, {
      x: cardX + 0.12,
      y: cardY + (group.label ? 0.44 : 0.14),
      w: cardWidth - 0.24,
      h: cardHeight - (group.label ? 0.56 : 0.28),
      fontSize: 10.5,
      color: COLORS.text,
      margin: 0,
      breakLine: false,
      fit: "shrink",
      valign: "top",
    });
  });
}

function drawVisual(
  slide: PptxSlide,
  pptx: InstanceType<typeof pptxgen>,
  visual: PresentationVisual,
  y: number,
): void {
  const x = 8.55;
  const width = 4.13;
  const height = 6.48 - y;
  const groups = visual.groups.length > 0 ? visual.groups : legacyVisualGroups(visual);
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w: width,
    h: height,
    rectRadius: 0.06,
    line: { color: visual.kind === "graphic" ? COLORS.amber : COLORS.cyan, transparency: 35, width: 1 },
    fill: { color: visual.kind === "graphic" ? "3A2C2A" : COLORS.panel },
  });
  addVisualHeader(slide, visual, x + 0.22, y + 0.2, width - 0.44);
  if (groups.length === 0) {
    slide.addText(visual.description.slice(0, 220), {
      x: x + 0.25,
      y: y + 0.75,
      w: width - 0.5,
      h: height - 1,
      fontSize: 14,
      color: COLORS.text,
      margin: 0,
      valign: "middle",
      fit: "shrink",
    });
    return;
  }
  if (visualLayout(visual) === "grid") {
    drawGridVisual(slide, visual, groups, x + 0.22, y + 0.58, width - 0.44, height - 0.82);
  } else {
    drawStackVisual(slide, pptx, visual, groups, x + 0.22, y + 0.58, width - 0.44, height - 0.82);
  }
}

function visibleFooter(refs: string[], sourceBaseUrl: string): string | pptxgen.TextProps[] {
  if (refs.length === 0) return "Generated content — no direct wiki source";
  const runs: pptxgen.TextProps[] = [{ text: "Sources: " }];
  refs.slice(0, 4).forEach((ref, index) => {
    if (index > 0) runs.push({ text: " · " });
    runs.push({
      text: `[${index + 1}] ${ref}`,
      options: {
        color: COLORS.cyan,
        hyperlink: { url: presentationSourceUrl(sourceBaseUrl, ref) },
      },
    });
  });
  if (refs.length > 4) runs.push({ text: ` · +${refs.length - 4} more in notes` });
  return runs;
}

/** Render an editable, source-traceable wide-screen PowerPoint deck. */
export async function renderPresentationPptx(input: {
  deck: PresentationDeck;
  projectName: string;
  sourceBaseUrl: string;
  /** Keep the supplied Outshift treatment opt-in while preserving existing exports by default. */
  useOutshiftTemplate?: boolean;
}): Promise<Uint8Array> {
  const { deck, projectName, sourceBaseUrl } = input;
  const useOutshiftTemplate = input.useOutshiftTemplate ?? true;
  const assets = useOutshiftTemplate ? await loadOutshiftAssets() : null;
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "TOME presentation export";
  pptx.company = useOutshiftTemplate ? "Outshift by Cisco" : "TOME";
  pptx.subject = `Presentation grounded in ${projectName}`;
  pptx.title = deck.title;
  pptx.theme = {
    headFontFace: "CiscoSansTT Light",
    bodyFontFace: "CiscoSansTT Light",
  };

  const physicalSlides = deck.slides.flatMap((slide, index) => paginateSlide(slide, index === 0 && !slide.visual));
  physicalSlides.forEach((page, slideIndex) => {
    const { content } = page;
    const renderedTitle = `${content.title}${page.continuation ? " — continued" : ""}`;
    const isCover = slideIndex === 0 && !content.visual;
    const titleY = isCover ? 1.58 : 0.82;
    const titleWidth = isCover ? 9.9 : 10.55;
    const titleLines = estimatedLineCount(renderedTitle, titleWidth);
    const titleHeight = isCover ? 1.42 : Math.min(1.2, Math.max(0.66, titleLines * 0.4));
    const subtitleY = titleY + titleHeight + 0.08;
    const bodyStart = isCover
      ? 3.72
      : subtitleY + (content.subtitle ? 0.48 : 0.12);
    const slideSourceRefs = presentationSourceRefs(content);
    const slide = pptx.addSlide();
    slide.background = { color: isCover && useOutshiftTemplate ? "000000" : COLORS.ink };
    if (isCover && useOutshiftTemplate && assets) {
      slide.addImage({ data: assets.grid, x: 0, y: 0, w: 13.333, h: 7.5 });
      slide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: 13.333,
        h: 7.5,
        line: { color: "000000", transparency: 100 },
        fill: { color: "000000", transparency: 18 },
      });
      slide.addImage({ data: assets.logoReversed, x: 0.56, y: 0.38, w: 1.35, h: 0.56 });
      slide.addText("TOME", {
        x: 11.65,
        y: 0.48,
        w: 1.12,
        h: 0.2,
        fontFace: "CiscoSansTT Light",
        fontSize: 10,
        bold: true,
        charSpacing: 1.5,
        color: COLORS.cyan,
        align: "right",
        margin: 0,
      });
    } else {
      slide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: 13.333,
        h: 0.08,
        line: { color: COLORS.cyan, transparency: 100 },
        fill: { color: COLORS.cyan },
      });
      if (useOutshiftTemplate && assets) {
        slide.addImage({ data: assets.logoReversed, x: 11.75, y: 0.24, w: 0.95, h: 0.39 });
      }
      slide.addText(projectName, {
        x: 0.7,
        y: 0.32,
        w: 4.8,
        h: 0.2,
        fontFace: "CiscoSansTT Light",
        fontSize: 9,
        bold: true,
        charSpacing: 0.8,
        color: COLORS.cyan,
        margin: 0,
        fit: "shrink",
      });
      slide.addShape(pptx.ShapeType.line, {
        x: 0.68,
        y: 0.72,
        w: 0.72,
        h: 0,
        line: { color: COLORS.amber, width: 1.5 },
      });
    }
    slide.addText(renderedTitle, {
      x: isCover ? 0.78 : 1.08,
      y: titleY,
      w: titleWidth,
      h: titleHeight,
      fontFace: "CiscoSansTT Light",
      fontSize: isCover ? 32 : 29,
      bold: false,
      color: COLORS.text,
      margin: 0,
      breakLine: false,
      fit: "shrink",
    });
    if (content.subtitle) {
      slide.addText(content.subtitle, {
        x: isCover ? 0.82 : 1.1,
        y: isCover ? 3.08 : subtitleY,
        w: isCover ? 9.2 : 10.4,
        h: 0.38,
        fontFace: "CiscoSansTT Light",
        fontSize: isCover ? 17 : 15,
        color: COLORS.muted,
        margin: 0,
        fit: "shrink",
      });
    }

    const hasVisual = page.showVisual && Boolean(content.visual?.description);
    const bodyWidth = hasVisual ? 7.55 : 11.85;
    let bulletY = bodyStart;
    page.bullets.forEach((bullet) => {
      const refs = bullet.source_refs;
      const marker = refs.length > 0
        ? `[${refs.map((ref) => slideSourceRefs.indexOf(ref) + 1).join(",")}]`
        : "AI";
      slide.addShape(pptx.ShapeType.line, {
        x: isCover ? 0.86 : 1.12,
        y: bulletY + 0.22,
        w: 0.22,
        h: 0,
        line: { color: bullet.generated ? COLORS.amber : COLORS.cyan, width: 1.2 },
      });
      slide.addText(`${bullet.text}  ${marker}`, {
        x: isCover ? 1.22 : 1.5,
        y: bulletY,
        w: bodyWidth - 0.65,
        h: estimatedBulletHeight(bullet, bodyWidth - 0.35),
        fontFace: "CiscoSansTT Light",
        fontSize: isCover ? 15 : 14,
        color: COLORS.text,
        margin: 0,
        valign: "top",
        breakLine: false,
        fit: "shrink",
      });
      bulletY += estimatedBulletHeight(bullet, bodyWidth - 0.35) + 0.1;
    });

    if (hasVisual && content.visual) {
      drawVisual(slide, pptx, content.visual, bodyStart);
    }

    const footer = visibleFooter(slideSourceRefs, sourceBaseUrl);
    const fullFooter = slideSourceRefs.length > 0
      ? `Sources:\n${slideSourceRefs.map((ref, index) => `[${index + 1}] ${presentationSourceUrl(sourceBaseUrl, ref)}`).join("\n")}`
      : "Generated content — no direct wiki source";
    slide.addShape(pptx.ShapeType.line, {
      x: 0.65,
      y: 6.82,
      w: 12.05,
      h: 0,
      line: { color: COLORS.line, width: 0.7 },
    });
    slide.addText(footer, {
      x: 0.68,
      y: 6.94,
      w: 11.35,
      h: 0.24,
      fontSize: 8,
      color: slideSourceRefs.length > 0 ? COLORS.muted : COLORS.amber,
      margin: 0,
      fit: "shrink",
    });
    slide.addText(`${slideIndex + 1} / ${physicalSlides.length}`, {
      x: 12.05,
      y: 6.94,
      w: 0.65,
      h: 0.24,
      fontSize: 8,
      color: COLORS.muted,
      align: "right",
      margin: 0,
    });
    if (content.speaker_notes) {
      const visualNotes = hasVisual && content.visual
        ? `\n\nVisual: ${content.visual.description}${content.visual.connections.length > 0 ? `\nConnections: ${content.visual.connections.join("; ")}` : ""}`
        : "";
      slide.addNotes(`${content.speaker_notes}${visualNotes}\n\n${fullFooter}`);
    } else if (slideSourceRefs.length > 0) {
      slide.addNotes(fullFooter);
    }
  });

  const output = await pptx.write({ outputType: "uint8array", compression: true });
  if (!(output instanceof Uint8Array)) throw new Error("PowerPoint renderer returned an unexpected output type");
  return output;
}
