"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  matchTomeEmbedUrl,
  parseTomeEmbed,
  serializeTomeEmbedBlock,
  type TomeEmbedProvider,
} from "@/lib/tome/embeds";
import {
  normalizeVidcastUrl,
  setVidcastPlaylistExpanded,
} from "@/lib/tome/vidcast";
import { excalidrawFileToMarkdown } from "@/lib/tome/excalidraw";
import { cn } from "@/lib/utils";

type InsertMediaType = TomeEmbedProvider | "excalidraw";

const PROVIDERS: Array<{ value: InsertMediaType; label: string; hint: string }> = [
  { value: "youtube", label: "YouTube", hint: "Video or playlist URL" },
  { value: "vidcast", label: "Vidcast", hint: "Video share or playlist URL" },
  { value: "arxiv", label: "arXiv", hint: "Paper URL or arXiv ID" },
  { value: "pdf", label: "PDF", hint: "Direct HTTPS .pdf URL" },
  { value: "excalidraw", label: "Excalidraw", hint: "Excalidraw drawing file" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (markdown: string) => void;
}

export function TomeMediaInsertDialog({ open, onOpenChange, onInsert }: Props) {
  const [provider, setProvider] = useState<InsertMediaType>("youtube");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [playlistExpanded, setPlaylistExpanded] = useState(true);
  const [excalidrawBlock, setExcalidrawBlock] = useState("");
  const [excalidrawFileName, setExcalidrawFileName] = useState("");
  const [excalidrawError, setExcalidrawError] = useState<string | null>(null);
  const [readingExcalidraw, setReadingExcalidraw] = useState(false);
  const isExcalidraw = provider === "excalidraw";
  const isVidcastPlaylist =
    provider === "vidcast" && normalizeVidcastUrl(url)?.resourceType === "playlist";
  const serializedUrl = isVidcastPlaylist
    ? (setVidcastPlaylistExpanded(url, playlistExpanded) ?? url)
    : url;
  const block = useMemo(
    () =>
      isExcalidraw
        ? excalidrawBlock
        : serializeTomeEmbedBlock(provider, serializedUrl, title),
    [excalidrawBlock, isExcalidraw, provider, serializedUrl, title],
  );
  const validation = useMemo(
    () =>
      isExcalidraw
        ? null
        : url.trim()
          ? parseTomeEmbed(
              provider,
              block.split("\n").slice(1, -1).join("\n"),
            )
          : null,
    [block, isExcalidraw, provider, url],
  );
  const error = isExcalidraw
    ? excalidrawError
    : validation?.ok === false
      ? validation.error
      : null;

  const insert = () => {
    if (isExcalidraw ? !excalidrawBlock : !validation?.ok) return;
    onInsert(`\n\n${block}\n\n`);
    setUrl("");
    setTitle("");
    setPlaylistExpanded(true);
    setExcalidrawBlock("");
    setExcalidrawFileName("");
    setExcalidrawError(null);
    onOpenChange(false);
  };

  const readExcalidraw = async (file: File | undefined) => {
    setExcalidrawBlock("");
    setExcalidrawFileName(file?.name ?? "");
    setExcalidrawError(null);
    if (!file) return;
    setReadingExcalidraw(true);
    try {
      setExcalidrawBlock(await excalidrawFileToMarkdown(file));
    } catch (readError) {
      setExcalidrawError(
        readError instanceof Error
          ? readError.message
          : "The Excalidraw file could not be read.",
      );
    } finally {
      setReadingExcalidraw(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Insert media</DialogTitle>
          <DialogDescription>
            Add a YouTube, Vidcast, arXiv, direct PDF, or native Excalidraw preview. To keep a URL
            as a regular link without a preview, paste it directly into the document instead.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-5"
            role="group"
            aria-label="Media type"
          >
            {PROVIDERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setProvider(option.value)}
                className={cn(
                  "rounded-md border px-2 py-2 text-sm",
                  provider === option.value ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
                )}
                aria-pressed={provider === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
          {isExcalidraw ? (
            <div className="grid gap-2">
              <Label htmlFor="tome-excalidraw-file">Excalidraw drawing file</Label>
              <Input
                key="excalidraw-file"
                id="tome-excalidraw-file"
                type="file"
                accept=".excalidraw,application/json"
                onChange={(event) => void readExcalidraw(event.target.files?.[0])}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                The validated drawing is stored directly in Markdown as an Excalidraw JSON fence.
                External Excalidraw links are not embedded.
              </p>
              {excalidrawBlock && (
                <p className="text-sm text-muted-foreground" role="status">
                  Ready to insert {excalidrawFileName}.
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="tome-media-url">
                {PROVIDERS.find((item) => item.value === provider)?.hint}
              </Label>
              <Input
                key="external-media-url"
                id="tome-media-url"
                value={url}
                onChange={(event) => {
                  const nextUrl = event.target.value;
                  setUrl(nextUrl);
                  const match = matchTomeEmbedUrl(nextUrl);
                  if (match) setProvider(match.provider);
                  const vidcast = normalizeVidcastUrl(nextUrl);
                  if (vidcast?.resourceType === "playlist") {
                    setPlaylistExpanded(new URL(nextUrl).searchParams.get("expand") !== "0");
                  }
                }}
                placeholder="https://…"
                autoFocus
              />
            </div>
          )}
          {isVidcastPlaylist && (
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div className="grid gap-1">
                <Label htmlFor="tome-vidcast-playlist-expanded">Show playlist videos</Label>
                <p className="text-xs text-muted-foreground">
                  Open the playlist tray so every video is immediately visible and selectable.
                </p>
              </div>
              <Switch
                id="tome-vidcast-playlist-expanded"
                checked={playlistExpanded}
                onCheckedChange={setPlaylistExpanded}
                aria-label="Show playlist videos"
              />
            </div>
          )}
          {!isExcalidraw && (
            <div className="grid gap-2">
              <Label htmlFor="tome-media-title">Accessible title</Label>
              <Input
                id="tome-media-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Describe this content"
                maxLength={200}
              />
            </div>
          )}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            onClick={insert}
            disabled={readingExcalidraw || (isExcalidraw ? !excalidrawBlock : !validation?.ok)}
          >
            {readingExcalidraw ? "Reading…" : "Insert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
