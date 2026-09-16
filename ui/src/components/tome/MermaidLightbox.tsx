"use client";

import { Minus, Plus } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MERMAID_ZOOM_MIN = 25;
const MERMAID_ZOOM_MAX = 200;
const MERMAID_ZOOM_STEP = 25;

export type ExpandedMermaidDiagram = {
  svg: string;
  width: number;
};

export function expandedMermaidDiagramFrom(
  expandButton: Element,
): ExpandedMermaidDiagram | null {
  const svg = expandButton
    .closest(".tome-mermaid-preview")
    ?.querySelector<SVGSVGElement>(".tome-mermaid-canvas svg");
  if (!svg) return null;

  const viewBoxWidth = Number(svg.getAttribute("viewBox")?.split(/\s+/)[2]);
  const renderedWidth = svg.getBoundingClientRect().width;
  return {
    // The SVG has already passed through the renderer's DOM sanitizer.
    svg: svg.outerHTML,
    width: Math.max(
      Number.isFinite(viewBoxWidth) ? viewBoxWidth : 0,
      renderedWidth,
      1200,
    ),
  };
}

export function MermaidLightbox({
  diagram,
  onClose,
}: {
  diagram: ExpandedMermaidDiagram | null;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(100);

  return (
    <Dialog
      open={diagram !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setZoom(100);
        }
      }}
    >
      <DialogContent className="tome-mermaid-lightbox">
        <div className="tome-mermaid-lightbox-header">
          <DialogHeader>
            <DialogTitle>Mermaid diagram</DialogTitle>
            <DialogDescription>
              Zoom the diagram, then scroll to inspect it.
            </DialogDescription>
          </DialogHeader>
          <div
            className="tome-mermaid-zoom-controls"
            role="group"
            aria-label="Mermaid diagram zoom controls"
          >
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Zoom out Mermaid diagram"
              title="Zoom out"
              disabled={zoom === MERMAID_ZOOM_MIN}
              onClick={() =>
                setZoom((value) =>
                  Math.max(MERMAID_ZOOM_MIN, value - MERMAID_ZOOM_STEP),
                )
              }
            >
              <Minus aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="tome-mermaid-zoom-value"
              aria-label="Reset Mermaid zoom"
              title="Reset zoom"
              onClick={() => setZoom(100)}
            >
              {zoom}%
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Zoom in Mermaid diagram"
              title="Zoom in"
              disabled={zoom === MERMAID_ZOOM_MAX}
              onClick={() =>
                setZoom((value) =>
                  Math.min(MERMAID_ZOOM_MAX, value + MERMAID_ZOOM_STEP),
                )
              }
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div
          className="tome-mermaid-lightbox-canvas"
          style={
            {
              "--tome-mermaid-expanded-width": `${
                ((diagram?.width ?? 1200) * zoom) / 100
              }px`,
            } as CSSProperties
          }
          dangerouslySetInnerHTML={{ __html: diagram?.svg ?? "" }}
        />
      </DialogContent>
    </Dialog>
  );
}
