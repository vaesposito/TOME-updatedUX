/** Server-only bridge to the authenticated SharePoint MCP's bounded document routes. */
import { ApiError } from "@/lib/api-error";
import { createHash } from "crypto";
import { SHAREPOINT_FOLDER_LIST_LIMIT, SHAREPOINT_SELECTION_LIMIT, mergeSharePointSelections, parseSharePointFolderDocuments, parseSharePointSelection, parseSharePointSources, sharePointSourceKey, type SharePointFolderPreview } from "@/lib/projects/sharepoint-source";
import type { SharePointDocumentSource, SharePointSource } from "@/types/projects";
import { parseFrontmatter } from "./schema";
import { getPageStore } from "./page-store";

export function sharePointConfigured(): boolean {
  return Boolean(process.env.TOME_SHAREPOINT_API_URL?.trim() && process.env.TOME_SHAREPOINT_API_TOKEN?.trim());
}

export async function sharePointRequest<T>(path: string, params?: URLSearchParams, signal?: AbortSignal): Promise<T> {
  if (!sharePointConfigured()) {
    throw new ApiError("SharePoint is not configured. Contact an administrator.", 503, "SHAREPOINT_NOT_CONFIGURED");
  }
  const base = new URL(process.env.TOME_SHAREPOINT_API_URL!.replace(/\/$/, "") + "/");
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new ApiError("Invalid SharePoint service configuration. Contact an administrator.", 503, "SHAREPOINT_NOT_CONFIGURED");
  }
  // Callers supply only fixed route prefixes plus validated IDs, never provider URLs.
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error("Invalid SharePoint service route.");
  if (params) url.search = params.toString();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.TOME_SHAREPOINT_API_TOKEN}`, Accept: "application/json" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000), cache: "no-store", redirect: "error",
    });
  } catch {
    throw new ApiError("SharePoint could not be reached. Try refreshing; if this continues, contact an administrator.", 504, "SHAREPOINT_UNREACHABLE");
  }
  if (!response.ok) {
    const message = response.status === 404 ? "This SharePoint document or library no longer exists or is not accessible."
      : response.status === 413 ? "This SharePoint file or folder exceeds the configured ingestion limits. Choose a smaller folder or ingest individual files."
      : response.status === 415 ? "SharePoint ingestion currently supports PowerPoint (.pptx) and PDF files."
      : "SharePoint service access failed. Contact an administrator.";
    throw new ApiError(message, [404, 413, 415, 429].includes(response.status) ? response.status : 503, "SHAREPOINT_ACCESS_FAILED");
  }
  try { return await response.json() as T; }
  catch { throw new ApiError("SharePoint returned an invalid response. Contact an administrator.", 502, "INVALID_SHAREPOINT_RESPONSE"); }
}

export async function sharePointMetadata(ref: SharePointDocumentSource, signal?: AbortSignal): Promise<SharePointDocumentSource> {
  parseSharePointSelection([ref]);
  const row = await sharePointRequest<Record<string, unknown>>(`documents/${encodeURIComponent(ref.drive_id)}/${encodeURIComponent(ref.item_id)}/metadata`, undefined, signal);
  try {
    const source = parseSharePointSelection([row])[0];
    if (sharePointSourceKey(source) !== sharePointSourceKey(ref)) throw new Error("Mismatched metadata identity");
    return source;
  } catch { throw new ApiError("SharePoint returned invalid document metadata. Contact an administrator.", 502, "INVALID_SHAREPOINT_RESPONSE"); }
}

/** Validate new selections against the configured site, retaining saved references without repairing them. */
export async function prepareSharePointSources(value: unknown, previous: SharePointSource[] = []): Promise<SharePointSource[]> {
  let refs: SharePointSource[];
  try { refs = parseSharePointSources(value); }
  catch (error) { throw new ApiError((error as Error).message, 400, "INVALID_SHAREPOINT_SOURCE"); }
  const saved = new Map(previous.map((source) => [sharePointSourceKey(source), source]));
  const result: SharePointSource[] = [];
  const previews = new Map<string, SharePointFolderPreview>();
  const deadline = AbortSignal.timeout(45_000);
  const additions = refs.filter((ref) => !saved.has(sharePointSourceKey(ref)));
  let changed = false;
  if (additions.some((ref) => ref.kind !== "folder")) {
    throw new ApiError("Add folders as SharePoint sources. For a single PDF or PowerPoint file, use Run ingest → Add context: SharePoint documents.", 400, "INVALID_SHAREPOINT_SOURCE");
  }
  for (const ref of refs) {
    const retained = saved.get(sharePointSourceKey(ref));
    if (retained) {
      if (retained.kind !== ref.kind) throw new ApiError("A saved SharePoint source cannot change type.", 400, "INVALID_SHAREPOINT_SOURCE");
      if (ref.kind !== "folder" || retained.kind !== "folder"
        || (JSON.stringify([...ref.selected_item_ids ?? []].sort()) === JSON.stringify([...retained.selected_item_ids ?? []].sort())
          && JSON.stringify(ref.excluded_item_ids?.slice().sort()) === JSON.stringify(retained.excluded_item_ids?.slice().sort()))) {
        result.push(retained);
        continue;
      }
    }
    if (ref.kind !== "folder" || !ref.selected_item_ids) throw new ApiError("Choose 1–10 existing files for this SharePoint folder. Files added later are discovered automatically.", 400, "INVALID_SHAREPOINT_SOURCE");
    const preview = await sharePointFolderPreview(ref, deadline);
    // An empty initial batch watches an empty folder, not an implicit exclusion of existing files.
    if (!ref.selected_item_ids.length && preview.document_count > 0) {
      throw new ApiError("This SharePoint folder contains PDF/PPTX files. Refresh the folder and choose 1–10 existing files before saving. Empty folders can be attached without selecting files.", 400, "INVALID_SHAREPOINT_SOURCE");
    }
    previews.set(sharePointSourceKey(ref), preview);
    const selectedIds = new Set(ref.selected_item_ids);
    // The server, not caller-supplied exclusions, captures files explicitly left unchecked.
    // Keep exclusions for temporarily absent items; restoring an old ID must not enable it.
    const excludedIds = new Set(retained?.kind === "folder" ? retained.excluded_item_ids ?? [] : []);
    for (const file of preview.documents) if (!selectedIds.has(file.item_id)) excludedIds.add(file.item_id);
    for (const id of selectedIds) excludedIds.delete(id);
    if (excludedIds.size > SHAREPOINT_FOLDER_LIST_LIMIT) throw new ApiError("This folder's exclusions exceed the safe listing limit. Contact an administrator.", 413, "SHAREPOINT_FOLDER_LIMIT");
    result.push({ ...preview.folder, selected_item_ids: [...ref.selected_item_ids], excluded_item_ids: [...excludedIds] });
    changed = true;
  }
  // Only explicit additions/selection edits trigger validation; removal never repairs saved sources.
  if (changed) await resolveSharePointDocuments(result, [], { previews, signal: deadline, initialSelectionOnly: true });
  return result;
}

export async function sharePointFolderPreview(ref: SharePointSource, signal?: AbortSignal): Promise<SharePointFolderPreview> {
  parseSharePointSources([ref]);
  const row = await sharePointRequest<SharePointFolderPreview>(`documents/${encodeURIComponent(ref.drive_id)}/${encodeURIComponent(ref.item_id)}/folder`, new URLSearchParams({ select_files: "true" }), signal);
  try {
    const folder = parseSharePointSources([row.folder])[0];
    if (folder.kind !== "folder" || sharePointSourceKey(folder) !== sharePointSourceKey(ref)) throw new Error("Wrong folder");
    const counts = [row.document_count, row.total_size, row.child_folder_count, row.unsupported_count];
    if (!counts.every((value) => Number.isSafeInteger(value) && value >= 0)
      || typeof row.within_limits !== "boolean" || row.limits?.max_documents !== 10
      || !Number.isSafeInteger(row.limits.max_total_bytes) || row.limits.max_total_bytes <= 0) throw new Error("Invalid limits");
    const documents = parseSharePointFolderDocuments(row.documents);
    if (documents.some((document) => document.drive_id !== ref.drive_id || !Number.isSafeInteger(document.size))
      || documents.length !== row.document_count
      || documents.reduce((sum, document) => sum + document.size!, 0) !== row.total_size
      || row.within_limits !== (row.document_count <= 10 && row.total_size <= row.limits.max_total_bytes)) throw new Error("Invalid children");
    return { ...row, folder, documents };
  } catch { throw new ApiError("SharePoint returned an invalid folder preview. Contact an administrator.", 502, "INVALID_SHAREPOINT_RESPONSE"); }
}

/** Same identity/version contract as PreparedDocument.matches_wiki_page; a cache alone is not ingestion. */
function currentSharePointSummary(file: SharePointDocumentSource, pages: Record<string, string>): boolean {
  const key = "doc-" + createHash("sha256").update(JSON.stringify([file.drive_id, file.item_id])).digest("hex").slice(0, 24);
  const [frontmatter, body] = parseFrontmatter(pages[`sharepoint/${key}.md`] ?? "");
  if (!body.trim() || frontmatter.source_provider !== "sharepoint" || frontmatter.source_document_key !== key) return false;
  if (frontmatter.kind === "stable" || frontmatter.kind === "hidden") return true;
  return Boolean(file.version && frontmatter.kind === "dynamic"
    && frontmatter.source_version === "sha256:" + createHash("sha256").update(file.version).digest("hex"));
}

interface ResolveSharePointOptions {
  previews?: Map<string, SharePointFolderPreview>;
  signal?: AbortSignal;
  existingPages?: Record<string, string>;
  /** Source edits validate the chosen initial batch, not unrelated later additions. */
  initialSelectionOnly?: boolean;
}

/** Resolve current direct children once per run; no recursion, stored-source rewrites, or automatic recovery. */
export async function resolveSharePointDocuments(sources: SharePointSource[], context: SharePointDocumentSource[] = [], options: ResolveSharePointOptions = {}): Promise<SharePointDocumentSource[]> {
  const refs = parseSharePointSources(sources);
  const files = refs.filter((ref): ref is SharePointDocumentSource => ref.kind !== "folder");
  const folders = refs.filter((ref) => ref.kind === "folder");
  if (!folders.length) return mergeSharePointSelections(files, context);
  const deadline = options.signal ?? AbortSignal.timeout(45_000);
  const children: SharePointDocumentSource[] = [];
  let byteLimit = Number.MAX_SAFE_INTEGER;
  for (const folder of folders) {
    const preview = options.previews?.get(sharePointSourceKey(folder)) ?? await sharePointFolderPreview(folder, deadline);
    byteLimit = Math.min(byteLimit, preview.limits.max_total_bytes);
    if (folder.selected_item_ids) {
      const available = new Map(preview.documents.map((file) => [file.item_id, file]));
      const missing = folder.selected_item_ids.filter((id) => !available.has(id));
      if (missing.length) throw new ApiError(`${missing.length} selected file(s) in SharePoint folder "${preview.folder.name}" are no longer available as direct PDF/PPTX files. Review the folder's file selection in Sources. No replacement files were selected.`, 404, "SHAREPOINT_SELECTED_FILE_MISSING");
      if (folder.excluded_item_ids && !options.initialSelectionOnly) {
        const excluded = new Set(folder.excluded_item_ids);
        children.push(...preview.documents.filter((file) => !excluded.has(file.item_id)));
      } else children.push(...folder.selected_item_ids.map((id) => available.get(id)!));
    } else {
      // Preserve legacy direct-all sources; never silently convert their persisted selection.
      if (!options.existingPages && !preview.within_limits) throw new ApiError(`SharePoint folder "${preview.folder.name}" exceeds the limit (${preview.document_count} documents, ${preview.total_size} bytes). Choose up to 10 files for this folder in Sources.`, 413, "SHAREPOINT_FOLDER_LIMIT");
      children.push(...preview.documents);
    }
  }
  // Deduplicate and remove already-ingested versions BEFORE enforcing the per-run limit.
  const candidates = [...new Map([...files, ...context, ...children].map((file) => [sharePointSourceKey(file), file])).values()];
  const childKeys = new Set(children.map(sharePointSourceKey));
  for (let index = 0; index < candidates.length; index++) {
    if (!childKeys.has(sharePointSourceKey(candidates[index]))) candidates[index] = await sharePointMetadata(candidates[index], deadline);
  }
  const documents = options.existingPages ? candidates.filter((file) => !currentSharePointSummary(file, options.existingPages!)) : candidates;
  if (documents.length > SHAREPOINT_SELECTION_LIMIT) throw new ApiError(`${documents.length} new or changed SharePoint documents need ingestion: more than ${SHAREPOINT_SELECTION_LIMIT} unique documents in one run. Choose up to ${SHAREPOINT_SELECTION_LIMIT} files in Sources or fewer one-off documents. No partial batch was started.`, 413, "SHAREPOINT_FOLDER_LIMIT");
  if (documents.some((document) => !Number.isSafeInteger(document.size))
    || documents.reduce((sum, document) => sum + document.size!, 0) > byteLimit) {
    throw new ApiError("Selected SharePoint documents exceed the total size limit. Choose smaller folders or fewer files.", 413, "SHAREPOINT_FOLDER_LIMIT");
  }
  return documents;
}

/** Fresh metadata preflight for optional per-run context; never saves project sources. */
export async function prepareManualSharePointDocuments(value: unknown, saved: SharePointSource[] = [], projectId?: string): Promise<SharePointDocumentSource[] | undefined> {
  if (value === undefined) return undefined;
  let refs: SharePointDocumentSource[];
  try {
    refs = parseSharePointSelection(value);
    mergeSharePointSelections(saved.filter((source): source is SharePointDocumentSource => source.kind !== "folder"), refs);
  } catch (error) { throw new ApiError((error as Error).message, 400, "INVALID_SHAREPOINT_SOURCE"); }
  const deadline = AbortSignal.timeout(45_000);
  const result: SharePointDocumentSource[] = [];
  for (let offset = 0; offset < refs.length; offset += 2) {
    result.push(...await Promise.all(refs.slice(offset, offset + 2).map((ref) => sharePointMetadata(ref, deadline))));
  }
  if (refs.length && saved.some((source) => source.kind === "folder")) await resolveSharePointDocuments(saved, result, {
    signal: deadline, existingPages: projectId ? await (await getPageStore()).listPages(projectId) : undefined,
  });
  return result;
}

export async function checkSharePointSources(refs: SharePointSource[], projectId?: string) {
  if (refs.some((source) => source.kind === "folder")) {
    try {
      const documents = await resolveSharePointDocuments(refs, [], {
        existingPages: projectId ? await (await getPageStore()).listPages(projectId) : undefined,
      });
      return { accessible: refs.map((ref) => ref.name), inaccessible: [], no_token: false, fixable_by_user: false,
        detail: `${documents.length} PDF/PPTX document(s) need ingestion. Selected existing files and later folder additions are included; unchecked existing files and subfolders are excluded. Unchanged ingested versions are skipped. Runs as the configured SharePoint application.` };
    } catch (error) {
      return { accessible: [], inaccessible: refs.map((ref) => ref.name), no_token: false, fixable_by_user: false,
        detail: error instanceof ApiError ? error.message : "SharePoint folder access failed. Contact an administrator." };
    }
  }
  const accessible: string[] = [];
  const inaccessible: string[] = [];
  // One deadline for the entire preflight, at most two Graph lookups at once.
  const deadline = AbortSignal.timeout(45_000);
  let serviceFailed = false;
  const files = refs.filter((ref): ref is SharePointDocumentSource => ref.kind !== "folder");
  for (let offset = 0; offset < files.length; offset += 2) {
    const batch = files.slice(offset, offset + 2);
    if (serviceFailed || deadline.aborted) { inaccessible.push(...batch.map((ref) => ref.name)); continue; }
    const checks = await Promise.all(batch.map(async (ref) => {
      try { await sharePointMetadata(ref, deadline); return true; }
      catch (error) {
        if (!(error instanceof ApiError) || ![404, 413, 415].includes(error.statusCode)) serviceFailed = true;
        return false;
      }
    }));
    checks.forEach((ok, index) => (ok ? accessible : inaccessible).push(batch[index].name));
  }
  return { accessible, inaccessible, no_token: false, fixable_by_user: false,
    detail: inaccessible.length ? "SharePoint app access or a selected document is unavailable. Contact an administrator." : "Runs as the configured SharePoint application." };
}
