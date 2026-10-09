"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ProviderLogo } from "@/components/credentials/provider-logo";
import { SharePointDocumentBrowser } from "@/components/projects/source-pickers/SharePointSourcePicker";
import { Button } from "@/components/ui/button";
import { SHAREPOINT_SELECTION_LIMIT, sharePointSourceKey } from "@/lib/projects/sharepoint-source";
import type { SharePointDocumentSource, SharePointSource } from "@/types/projects";

/** Optional run context, kept separate from the project's saved source list. */
export function SharePointIngestContext({ slug, selected, saved, onChange, disabled }: {
  slug: string;
  selected: SharePointDocumentSource[];
  saved: SharePointSource[];
  onChange: (next: SharePointDocumentSource[]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return <section className="px-4 py-3" aria-label="SharePoint context">
    <button type="button" className="flex w-full items-center gap-2 text-left text-sm"
      aria-expanded={open} aria-controls={contentId} onClick={() => setOpen((value) => !value)}>
      {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
      <ProviderLogo provider="sharepoint" className="h-4 w-4 shrink-0 object-contain" />
      <span className="font-medium">Add context: SharePoint documents</span>
      {selected.length > 0 && <span className="ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{selected.length} selected</span>}
    </button>
    {open && <div id={contentId} className="mt-2 space-y-3">
      <p className="text-xs text-muted-foreground">Per-run only, not saved to the project or included in future auto-ingests. Runs as the configured SharePoint application. Large decks may take several minutes.</p>
      {selected.length > 0 && <ul aria-label="SharePoint documents for this run" className="divide-y divide-border/40">
        {selected.map((document) => <li key={sharePointSourceKey(document)} className="flex items-center justify-between gap-3 py-2">
          <span className="min-w-0 break-words text-sm">{document.name}</span>
          <Button type="button" size="sm" variant="ghost" disabled={disabled} aria-label={`Remove context document ${document.name}`}
            onClick={() => onChange(selected.filter((item) => sharePointSourceKey(item) !== sharePointSourceKey(document)))}>Remove</Button>
        </li>)}
      </ul>}
      <SharePointDocumentBrowser projectSlug={slug} selected={selected} excluded={saved.filter((source): source is SharePointDocumentSource => source.kind !== "folder")} onChange={onChange} disabled={disabled}
        description={`Choose PDF or PowerPoint (.pptx) files for one-off ingestion. Saved folder contents and files are also included; this run can include up to ${SHAREPOINT_SELECTION_LIMIT} unique SharePoint documents in total. SharePoint site pages are not supported yet.`} />
    </div>}
  </section>;
}
