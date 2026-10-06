"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileText, Folder, RefreshCw } from "lucide-react";
import { ProviderLogo } from "@/components/credentials/provider-logo";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select";
import { SearchablePicker } from "@/components/ui/searchable-picker";
import { SHAREPOINT_SELECTION_LIMIT, sharePointSourceKey, type SharePointFolderPreview } from "@/lib/projects/sharepoint-source";
import { formatBytes } from "@/lib/tome/format";
import type { SharePointDocumentSource, SharePointFolderSource, SharePointSource } from "@/types/projects";

interface CatalogItem { id: string; name: string; webUrl?: string; size?: number; folder?: boolean; supported?: boolean }
interface CatalogPage { configured: boolean; items: CatalogItem[]; has_more: boolean; next_cursor?: string | null }

async function loadPage(params: URLSearchParams, signal: AbortSignal): Promise<CatalogPage> {
  const response = await fetch(`/api/projects/sharepoint-options?${params}`, { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load SharePoint. Contact an administrator.");
  const page = body.data as CatalogPage;
  if (!Array.isArray(page.items) || (page.has_more && !page.next_cursor)) throw new Error("SharePoint returned an invalid page. Try refreshing.");
  return page;
}

/** Domain loader owns pagination/cancellation; the shared picker owns listbox behavior. */
function useCatalog(params: URLSearchParams, enabled = true) {
  const key = params.toString();
  const remoteSearch = params.has("q");
  const [state, setState] = useState<{ key: string; page?: CatalogPage; loading: boolean; error?: string }>({ key, loading: true });
  const request = useRef<AbortController | null>(null);
  const [revision, setRevision] = useState(0);
  const fetchPage = useCallback(async (cursor?: string) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState((old) => ({ ...(cursor && old.key === key ? old : { key }), loading: true }));
    const query = new URLSearchParams(key);
    if (cursor) query.set("cursor", cursor);
    try {
      const page = await loadPage(query, controller.signal);
      if (controller.signal.aborted) return;
      setState((old) => ({ key, loading: false, page: { ...page, items: cursor && old.key === key
        ? [...new Map([...(old.page?.items ?? []), ...page.items].map((item) => [item.id, item])).values()] : page.items } }));
    } catch (error) {
      if (!controller.signal.aborted) setState((old) => ({ ...old, key, loading: false, error: (error as Error).message }));
    }
  }, [key]);
  useEffect(() => {
    if (!enabled) return;
    // Remote search is debounced and obsolete account/library responses cannot replace newer ones.
    const timer = setTimeout(() => void fetchPage(), remoteSearch ? 300 : 0);
    return () => { clearTimeout(timer); request.current?.abort(); };
  }, [fetchPage, revision, enabled, remoteSearch]);
  const current = state.key === key ? state : { key, loading: true, page: undefined, error: undefined };
  return { ...current, reload: () => setRevision((n) => n + 1),
    loadMore: () => { if (!current.loading && current.page?.next_cursor) void fetchPage(current.page.next_cursor); } };
}

export function SharePointDocumentBrowser({ selected, onChange, projectSlug, excluded = [], disabled = false, description }: {
  selected: SharePointDocumentSource[];
  onChange: (next: SharePointDocumentSource[]) => void;
  projectSlug?: string;
  excluded?: SharePointDocumentSource[];
  disabled?: boolean;
  description?: string;
}) {
  const [library, setLibrary] = useState<CatalogItem>();
  const [folders, setFolders] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const rootParams = new URLSearchParams();
  if (projectSlug) rootParams.set("project_slug", projectSlug);
  const libraries = useCatalog(rootParams, !disabled);
  const fileParams = new URLSearchParams(rootParams);
  if (library) fileParams.set("drive_id", library.id);
  if (query.trim()) fileParams.set("q", query.trim());
  else if (folders.length) fileParams.set("folder_item_id", folders[folders.length - 1].id);
  const files = useCatalog(fileParams, Boolean(library) && !disabled);
  const saved = new Set([...excluded, ...selected].map(sharePointSourceKey));
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">{description ?? `Choose up to ${SHAREPOINT_SELECTION_LIMIT} PDF or PowerPoint (.pptx) files. The configured application reads these files for manual and scheduled ingest. Large decks may take several minutes.`}</p>
    {libraries.page?.configured === false ? <p className="text-sm text-muted-foreground">SharePoint is not configured. Contact an administrator.</p> : <>
      <SearchablePicker options={libraries.page?.items ?? []} selected={library}
        disabled={disabled} isOptionDisabled={() => disabled}
        onSelect={(item) => { setLibrary(item); setFolders([]); setQuery(""); }}
        getOptionKey={(item) => item.id} getOptionLabel={(item) => item.name}
        ariaLabel="SharePoint document library" placeholder="Choose a document library" searchPlaceholder="Search libraries"
        emptyLabel="No document libraries found" loading={libraries.loading && !libraries.page} error={libraries.error}
        onRetry={libraries.reload} hasMore={libraries.page?.has_more} loadingMore={libraries.loading && Boolean(libraries.page)} onLoadMore={libraries.loadMore} />
      {library && <>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => { setFolders([]); setQuery(""); }}>{library.name}</Button>
          {folders.map((folder, index) => <Button type="button" size="sm" variant="ghost" disabled={disabled} key={folder.id}
            onClick={() => { setFolders(folders.slice(0, index + 1)); setQuery(""); }}>/ {folder.name}</Button>)}
          <Button type="button" size="sm" variant="ghost" disabled={disabled} aria-label="Refresh SharePoint files" onClick={files.reload}><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
        <SearchablePicker options={(files.page?.items ?? []).filter((item) => item.folder || !saved.has(`${library.id}/${item.id}`))}
          onSelect={(item) => {
            if (item.folder) { setFolders([...folders, item]); setQuery(""); }
            else onChange([...selected, { drive_id: library.id, item_id: item.id, name: item.name, web_url: item.webUrl, size: item.size }]);
          }}
          getOptionKey={(item) => item.id} getOptionLabel={(item) => item.name}
          disabled={disabled} isOptionDisabled={(item) => disabled || (!item.folder && (!item.supported || saved.size >= SHAREPOINT_SELECTION_LIMIT))}
          renderOption={(item) => <span className="flex items-center gap-2">{item.folder ? <Folder className="h-4 w-4" /> : <FileText className="h-4 w-4" />}{item.name}{!item.folder && !item.supported ? " (unavailable or too large)" : ""}</span>}
          ariaLabel="Add SharePoint document" placeholder="Browse folders or add a document" searchPlaceholder="Search this library"
          searchValue={query} onSearchChange={setQuery} filterOptions={false}
          emptyLabel="No unselected PDF or PowerPoint files here. Browse a folder or search the library."
          loading={files.loading && !files.page} error={files.error} onRetry={files.reload}
          hasMore={files.page?.has_more} loadingMore={files.loading && Boolean(files.page)} onLoadMore={files.loadMore} />
      </>}
    </>}
  </div>;
}

export function SharePointSourcePicker({ selected, onChange, readOnly = false, projectSlug }: {
  selected: SharePointSource[];
  onChange: (next: SharePointSource[]) => void;
  readOnly?: boolean;
  projectSlug?: string;
}) {
  const [editingSource, setEditingSource] = useState<SharePointFolderSource>();
  return <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-label="SharePoint source">
    <div className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-4 py-3">
      <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-[#038387]/10">
        <ProviderLogo provider="sharepoint" className="h-[15px] w-[15px] object-contain" />
      </span>
      <h3 className="text-sm font-semibold leading-tight">SharePoint source</h3>
    </div>
    <section aria-label="Selected SharePoint sources" className="px-4 py-4">
      <h4 className="text-sm font-medium">Selected SharePoint sources</h4>
      {selected.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No folders selected.</p> : <ul className="divide-y divide-border/40">
        {selected.map((source) => <li className="flex items-center justify-between gap-3 py-2" key={sharePointSourceKey(source)}>
          <div className="min-w-0">
            <p className="break-words text-sm">{source.name}</p>
            <p className="text-xs text-muted-foreground">{source.kind === "folder"
              ? source.selected_item_ids ? source.excluded_item_ids
                ? `Folder · ${source.selected_item_ids.length} initially selected file(s) + future additions`
                : `Previously saved fixed selection · ${source.selected_item_ids.length} file(s); choose files and save to enable future additions`
                : "Previously attached folder · All direct PDF/PPTX files; subfolders excluded"
              : "Previously attached individual file"}</p>
            <p className="text-xs text-muted-foreground">Runs as: configured SharePoint application</p>
          </div>
          {!readOnly && <div className="flex shrink-0 gap-1">
            {source.kind === "folder" && <Button type="button" size="sm" variant="ghost" aria-label={`Choose files in ${source.name}`}
              onClick={() => setEditingSource({ ...source })}>Choose files</Button>}
            <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${source.name}`}
              onClick={() => onChange(selected.filter((item) => sharePointSourceKey(item) !== sharePointSourceKey(source)))}>Remove</Button>
          </div>}
        </li>)}
      </ul>}
    </section>
    {!readOnly && <section aria-label="Add a SharePoint folder" className="space-y-3 border-t border-border px-4 py-4">
      <h4 className="text-sm font-medium">Add a SharePoint folder</h4>
      <p className="text-xs text-muted-foreground">Choose up to 10 existing direct PDF/PPTX files for the initial ingest. Future manual and auto-ingests discover files added later and changes to included files. Existing files you leave unchecked stay excluded. Nested folders must be added separately.</p>
      <p className="text-xs text-muted-foreground">For a single PDF or PowerPoint file, use {projectSlug
        ? <Link className="text-primary hover:underline" href={`/projects/${encodeURIComponent(projectSlug)}/tome/ingest`}>Run ingest → Add context: SharePoint documents</Link>
        : "Run ingest → Add context: SharePoint documents after creating the project"} for one-off ingestion. SharePoint site pages are not supported yet.</p>
      <SharePointFolderBrowser selected={selected} onChange={onChange} projectSlug={projectSlug} editingSource={editingSource} />
    </section>}
  </section>;
}

function SharePointFolderBrowser({ selected, onChange, projectSlug, editingSource }: {
  selected: SharePointSource[]; onChange: (sources: SharePointSource[]) => void; projectSlug?: string; editingSource?: SharePointFolderSource;
}) {
  const [library, setLibrary] = useState<CatalogItem>();
  const [folders, setFolders] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const [previewState, setPreviewState] = useState<{ key: string; preview?: SharePointFolderPreview; error?: string }>({ key: "" });
  const [revision, setRevision] = useState(0);
  const [choice, setChoice] = useState<{ key: string; ids: string[] }>({ key: "", ids: [] });
  const [selectionError, setSelectionError] = useState<{ key: string; message: string }>();
  useEffect(() => {
    if (!editingSource) return;
    setLibrary({ id: editingSource.drive_id, name: "Document library" });
    setFolders([{ id: editingSource.item_id, name: editingSource.name, folder: true }]);
    setQuery("");
    const key = sharePointSourceKey(editingSource);
    setChoice({ key, ids: [...editingSource.selected_item_ids ?? []] });
    setSelectionError(undefined);
  }, [editingSource]);
  const root = new URLSearchParams(projectSlug ? { project_slug: projectSlug } : {});
  const libraries = useCatalog(root);
  const params = new URLSearchParams(root);
  const folder = folders.at(-1);
  if (library) params.set("drive_id", library.id);
  if (query.trim()) params.set("q", query.trim());
  else if (folder) params.set("folder_item_id", folder.id);
  const catalog = useCatalog(params, Boolean(library));
  const previewParams = new URLSearchParams(root);
  if (library && folder) {
    previewParams.set("drive_id", library.id);
    previewParams.set("folder_item_id", folder.id);
    previewParams.set("preview", "true");
  }
  const previewKey = library && folder ? previewParams.toString() : "";
  useEffect(() => {
    if (!previewKey) return;
    const controller = new AbortController();
    setPreviewState({ key: previewKey });
    void (async () => {
      try {
        const response = await fetch(`/api/projects/sharepoint-options?${previewKey}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to preview this folder. Try refreshing.");
        if (!body.data?.folder || !Array.isArray(body.data.documents) || typeof body.data.within_limits !== "boolean") throw new Error("Invalid folder preview. Contact an administrator.");
        if (!controller.signal.aborted) setPreviewState({ key: previewKey, preview: body.data });
      } catch (error) {
        if (!controller.signal.aborted) setPreviewState({ key: previewKey, error: (error as Error).message });
      }
    })();
    return () => controller.abort();
  }, [previewKey, revision]);
  const preview = previewState.key === previewKey ? previewState.preview : undefined;
  const error = previewState.key === previewKey ? previewState.error : undefined;
  const folderKey = library && folder ? `${library.id}/${folder.id}` : "";
  const savedFolder = selected.find((source): source is SharePointFolderSource => source.kind === "folder" && sharePointSourceKey(source) === folderKey);
  const chosenIds = choice.key === folderKey ? choice.ids : savedFolder?.selected_item_ids ?? [];
  const available = new Map(preview?.documents.map((file) => [file.item_id, file]) ?? []);
  const missing = chosenIds.filter((id) => !available.has(id));
  const selectedBytes = chosenIds.reduce((sum, id) => sum + (available.get(id)?.size ?? 0), 0);
  const tooLarge = Boolean(preview && selectedBytes > preview.limits.max_total_bytes);
  const combinedKeys = new Set(selected.filter((source) => sharePointSourceKey(source) !== folderKey).flatMap((source) => source.kind === "folder"
    ? (source.selected_item_ids ?? []).map((id) => `${source.drive_id}/${id}`) : [sharePointSourceKey(source)]));
  for (const id of chosenIds) combinedKeys.add(`${library?.id}/${id}`);
  const tooMany = combinedKeys.size > SHAREPOINT_SELECTION_LIMIT;
  const alreadyAdded = Boolean(savedFolder);
  const selectedLimit = selected.length >= SHAREPOINT_SELECTION_LIMIT;
  return <div className="space-y-3">
    {libraries.page?.configured === false ? <p className="text-sm text-muted-foreground">SharePoint is not configured. Contact an administrator.</p> : <>
      <SearchablePicker options={libraries.page?.items ?? []} selected={library}
        onSelect={(item) => { setLibrary(item); setFolders([]); setQuery(""); }}
        getOptionKey={(item) => item.id} getOptionLabel={(item) => item.name}
        ariaLabel="SharePoint document library" placeholder="Choose a document library" searchPlaceholder="Search libraries"
        emptyLabel="No document libraries found" loading={libraries.loading && !libraries.page} error={libraries.error}
        onRetry={libraries.reload} hasMore={libraries.page?.has_more} loadingMore={libraries.loading && Boolean(libraries.page)} onLoadMore={libraries.loadMore} />
      {library && <>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Button type="button" size="sm" variant="ghost" onClick={() => { setFolders([]); setQuery(""); }}>{library.name}</Button>
          {folders.map((entry, index) => <Button type="button" size="sm" variant="ghost" key={entry.id}
            onClick={() => { setFolders(folders.slice(0, index + 1)); setQuery(""); }}>/ {entry.name}</Button>)}
          <Button type="button" size="sm" variant="ghost" aria-label="Refresh SharePoint folders" onClick={() => { catalog.reload(); setRevision((n) => n + 1); }}><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
        <SearchablePicker options={(catalog.page?.items ?? []).filter((item) => item.folder)}
          onSelect={(item) => { setFolders([...folders, item]); setQuery(""); }}
          getOptionKey={(item) => item.id} getOptionLabel={(item) => item.name}
          renderOption={(item) => <span className="flex items-center gap-2"><Folder className="h-4 w-4" />{item.name}</span>}
          ariaLabel="Browse SharePoint folders" placeholder="Browse into a folder" searchPlaceholder="Search folders in this library"
          searchValue={query} onSearchChange={setQuery} filterOptions={false}
          emptyLabel="No folders here. Files can be added as one-off context from Run ingest."
          loading={catalog.loading && !catalog.page} error={catalog.error} onRetry={catalog.reload}
          hasMore={catalog.page?.has_more} loadingMore={catalog.loading && Boolean(catalog.page)} onLoadMore={catalog.loadMore} />
        {folder && <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3" aria-label="SharePoint folder preview">
          <p className="text-sm font-medium">{folder.name}</p>
          {preview ? <>
            <p className="text-xs text-muted-foreground">{preview.document_count} direct PDF/PPTX document(s) · {formatBytes(preview.total_size)}</p>
            <p className="text-xs text-muted-foreground">{preview.child_folder_count} subfolder(s) excluded · {preview.unsupported_count} unsupported file(s) or shortcut(s) excluded.</p>
            <p className="text-xs text-muted-foreground">Select up to {preview.limits.max_documents} unique documents across your sources · {formatBytes(preview.limits.max_total_bytes)} selected total. No recursive ingestion.</p>
            <MultiSelect options={[...new Set([...available.keys(), ...chosenIds])]} selected={chosenIds}
              formatOption={(id) => available.has(id) ? `${available.get(id)!.name} · ${formatBytes(available.get(id)!.size ?? 0)}` : `Unavailable selected file (${id})`}
              onChange={(ids) => {
                if (ids.length > SHAREPOINT_SELECTION_LIMIT) { setSelectionError({ key: folderKey, message: "Select at most 10 files. Unselect a file before adding another." }); return; }
                setChoice({ key: folderKey, ids }); setSelectionError(undefined);
              }} placeholder="Choose files to ingest" searchPlaceholder="Search files in this folder" emptyLabel="No direct PDF/PPTX files found" badgeLabel="files" />
            <p className="text-xs text-muted-foreground">{chosenIds.length} selected · {formatBytes(selectedBytes)} for the initial ingest. Future runs also include new files added to this folder and changes to included files. Existing unchecked files stay excluded. At most 10 new/changed files per run.</p>
            {selectionError?.key === folderKey && <p role="alert" className="text-xs text-destructive">{selectionError.message}</p>}
            {tooLarge && <p role="alert" className="text-xs text-destructive">The selected files exceed the total size limit. Choose fewer or smaller files.</p>}
            {tooMany && <p role="alert" className="text-xs text-destructive">Your saved sources and this selection exceed 10 unique files. Unselect files before saving.</p>}
            {missing.length > 0 && <p role="alert" className="text-xs text-destructive">{missing.length} selected file(s) are unavailable. Remove them from the selection before saving; replacements are never selected automatically.</p>}
            {preview.document_count === 0 && <p className="text-xs text-muted-foreground">No direct PDF/PPTX files here. Browse a subfolder to select its files.</p>}
          </> : error ? <p role="alert" className="text-xs text-destructive">{error}</p> : <p role="status" className="text-xs text-muted-foreground">Checking document count and total size…</p>}
          {selectedLimit && !alreadyAdded && <p className="text-xs text-destructive">At most {SHAREPOINT_SELECTION_LIMIT} SharePoint sources can be attached.</p>}
          <Button type="button" size="sm" disabled={!preview || !chosenIds.length || missing.length > 0 || tooLarge || tooMany || (!alreadyAdded && selectedLimit)}
            onClick={() => {
              if (!preview) return;
              const excluded = new Set([...(savedFolder?.excluded_item_ids ?? []), ...preview.documents.map((file) => file.item_id)]);
              for (const id of chosenIds) excluded.delete(id);
              const source = { ...preview.folder, selected_item_ids: [...chosenIds], excluded_item_ids: [...excluded] };
              onChange(alreadyAdded ? selected.map((item) => sharePointSourceKey(item) === folderKey ? source : item) : [...selected, source]);
            }}>{alreadyAdded ? "Save file selection" : "Add this folder"}</Button>
        </div>}
      </>}
    </>}
  </div>;
}
