"use client";

import { Check, Plus, RotateCcw, SlidersHorizontal } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { widgetLabel, type TomeHomeWidgetId } from "@/lib/tome/home-widgets";

/**
 * The way in and out of arranging the home page.
 *
 * Closed, it is one quiet button, and says how many cards are put away — the
 * only state a reader cannot otherwise see, and the thing they will come
 * looking for when a card they remember is missing. Open, it says what the
 * controls on the cards do, since a grip and an eye are recognisable but not
 * self-explaining, and it is where a hidden card is brought back.
 */
export function HomeCustomizeBar({
  editing,
  hidden,
  customized,
  onEdit,
  onDone,
  onShow,
  onReset,
}: {
  editing: boolean;
  hidden: readonly TomeHomeWidgetId[];
  /** Whether there is an arrangement to undo, which is when Reset earns a place. */
  customized: boolean;
  onEdit: () => void;
  onDone: () => void;
  onShow: (id: TomeHomeWidgetId) => void;
  onReset: () => void;
}) {
  if (!editing) {
    return (
      <div className="flex items-center justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onEdit}
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          Customize
          {hidden.length > 0 && (
            <span className="text-muted-foreground/70">
              · {hidden.length} hidden
            </span>
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-xs text-muted-foreground">
          Drag a card by its handle to move it, or hide it with the eye. This
          arrangement follows you to every space.
        </p>
        {customized && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset
          </Button>
        )}
        <Button type="button" size="sm" onClick={onDone} className="h-7 gap-1.5 px-2.5 text-xs">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          Done
        </Button>
      </div>

      {hidden.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed pt-2">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Hidden
          </span>
          {hidden.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onShow(id)}
              className="flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              {widgetLabel(id)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
