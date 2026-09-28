"use client";

import { type MouseEvent, useState } from "react";
import { Download, FileCode2, FileText, Globe2, Sparkles } from "lucide-react";

import { BetaBadge } from "@/components/tome/BetaBadge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { PresentationExportDialog } from "@/components/tome/PresentationExportDialog";

const EXPORT_FORMATS = [
  ["pdf", "PDF", "Print-ready document", FileText, "application/pdf"],
  ["html", "HTML", "Self-contained web page", Globe2, "text/html"],
  ["markdown", "Markdown", "Portable source file", FileCode2, "text/markdown"],
] as const;

interface Props {
  slug: string;
  /** When present, export only this page; otherwise export the complete wiki. */
  path?: string;
  /** When present, export this gist instead of wiki content. */
  gist?: { id: string; title: string; filename: string };
  /** Page title, used to suggest a filename when picking a save location. */
  title?: string;
  triggerClassName?: string;
}

export function wikiExportHref(
  slug: string,
  format: string,
  path?: string,
  gistId?: string,
): string {
  const params = new URLSearchParams({ format });
  if (path) params.set("path", path);
  if (gistId) params.set("gist", gistId);
  return `/api/tome/projects/${encodeURIComponent(slug)}/export?${params.toString()}`;
}

function slugifyFilenameStem(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "wiki";
}

function suggestedExportFilename(format: string, slug: string, title?: string): string {
  const extension = format === "markdown" ? "md" : format;
  const stem = title ? slugifyFilenameStem(title) : `${slugifyFilenameStem(slug)}-wiki`;
  return `${stem}.${extension}`;
}

/**
 * showSaveFilePicker is Chromium-only (Chrome/Edge). Firefox and Safari fall
 * back to the anchor's native `download` behavior further down.
 */
function canPickSaveLocation(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

/** Shared document export menu and guided presentation workflow for wiki and gist exports. */
export function WikiExportMenu({ slug, path, gist, title, triggerClassName }: Props) {
  const [open, setOpen] = useState(false);
  const [presentationOpen, setPresentationOpen] = useState(false);
  const { toast } = useToast();
  const label = gist ? "Export this gist" : path ? "Export this page" : "Export complete wiki";

  async function handleExportClick(
    event: MouseEvent<HTMLAnchorElement>,
    format: string,
    mimeType: string,
  ) {
    setOpen(false);
    if (!canPickSaveLocation()) return;
    event.preventDefault();

    const suggestedName = suggestedExportFilename(format, slug, gist?.title ?? title);
    const extension = suggestedName.slice(suggestedName.lastIndexOf("."));
    let handle: FileSystemFileHandle;
    try {
      // Must be the first await: showSaveFilePicker needs the click's user
      // activation, which can expire before a slow PDF/PPTX export resolves.
      handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: mimeType, accept: { [mimeType]: [extension] } }],
      });
    } catch (err) {
      // User closed the picker without choosing a location; not an error.
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast("Could not open the save dialog", "error");
      return;
    }

    try {
      const response = await fetch(wikiExportHref(slug, format, path, gist?.id));
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      const writable = await handle.createWritable();
      if (response.body) {
        await response.body.pipeTo(writable);
      } else {
        await writable.close();
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save export", "error");
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={label}
          aria-label={label}
          className={cn(
            "rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground",
            triggerClassName,
          )}
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-56 p-2">
        <p className="px-2 pb-1.5 text-[11px] font-semibold text-foreground">
          {label}
        </p>
        {EXPORT_FORMATS.map(([format, formatLabel, description, Icon, mimeType]) => (
          <a
            key={format}
            href={wikiExportHref(slug, format, path, gist?.id)}
            download
            onClick={(event) => handleExportClick(event, format, mimeType)}
            className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted"
          >
            <Icon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-foreground">{formatLabel}</span>
              <span className="block text-[10px] text-muted-foreground">{description}</span>
            </span>
          </a>
        ))}
        <div className="my-1 border-t" />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPresentationOpen(true);
          }}
          className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
        >
          <Sparkles className="mt-0.5 h-3.5 w-3.5 text-primary" />
          <span>
            <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              Export as presentation
              <BetaBadge />
            </span>
            <span className="block text-[10px] text-muted-foreground">Guide AI, review, and choose the HTML or PowerPoint template</span>
          </span>
        </button>
      </PopoverContent>
      </Popover>
      <PresentationExportDialog
        slug={slug}
        currentPath={path}
        gist={gist}
        open={presentationOpen}
        onOpenChange={setPresentationOpen}
      />
    </>
  );
}
