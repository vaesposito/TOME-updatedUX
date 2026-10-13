"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EyeOff, GripVertical } from "lucide-react";
import * as React from "react";

import {
  widgetWidthClass,
  type TomeHomeWidget,
  type TomeHomeWidgetId,
} from "@/lib/tome/home-widgets";
import { cn } from "@/lib/utils";

/**
 * A card on the home page, with the controls that move and hide it.
 *
 * The controls appear only while the page is being arranged, rather than on
 * hover as the main home page's do. Every card here already has a link in its
 * top-right corner — All, Settings, Roadmap — which is exactly where a grip
 * would have to sit, and a reader reaching for Settings should not have to
 * aim. While arranging, the card itself goes inert: it has stopped being
 * something to read and become something to put somewhere.
 */
export function HomeWidgetFrame({
  widget,
  editing,
  onHide,
  children,
}: {
  widget: TomeHomeWidget;
  editing: boolean;
  onHide: (id: TomeHomeWidgetId) => void;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id, disabled: !editing });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative flex min-w-0 flex-col",
        widgetWidthClass(widget.width),
        editing &&
          "rounded-lg outline-dashed outline-1 outline-offset-2 outline-border",
        isDragging && "z-10 opacity-70",
      )}
      data-widget={widget.id}
    >
      {editing && (
        <div className="absolute right-2 top-2 z-20 flex items-center gap-1">
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Move ${widget.label}`}
            title="Drag to move, or use the arrow keys"
            className="flex h-7 w-7 cursor-grab items-center justify-center rounded-md border bg-background text-muted-foreground shadow-sm hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onHide(widget.id)}
            aria-label={`Hide ${widget.label}`}
            title="Hide this card"
            className="flex h-7 w-7 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-sm hover:text-foreground"
          >
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* The card fills the frame, so a short one still reaches the bottom of
          a row set by the card beside it. While arranging it also gives up
          its own corner link, which sits exactly where the grip has to go. */}
      <div
        className={cn(
          "flex flex-1 flex-col [&>*]:flex-1",
          editing &&
            "pointer-events-none select-none [&_[data-card-action]]:invisible",
        )}
      >
        {children}
      </div>
    </div>
  );
}
