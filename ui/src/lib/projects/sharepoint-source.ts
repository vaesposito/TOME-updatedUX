import type { SharePointDocumentSource, SharePointSource } from "@/types/projects";

export const SHAREPOINT_SELECTION_LIMIT = 10;

export interface SharePointFolderPreview {
  folder: Extract<SharePointSource, { kind: "folder" }>;
  documents: SharePointDocumentSource[];
  document_count: number;
  total_size: number;
  child_folder_count: number;
  unsupported_count: number;
  within_limits: boolean;
  limits: { max_documents: number; max_total_bytes: number };
}

export function sharePointSourceKey(source: Pick<SharePointDocumentSource, "drive_id" | "item_id">): string {
  return `${source.drive_id}/${source.item_id}`;
}

export function validSharePointId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 512 && /^[A-Za-z0-9!._~-]+$/.test(value)
    && value !== "." && value !== "..";
}

/** Strict and bounded: never silently drop a selected file or accept a download URL. */
export function parseSharePointSelection(value: unknown): SharePointDocumentSource[] {
  return parseSelection(value, false) as SharePointDocumentSource[];
}

/** Saved sources may contain direct-only folders; one-off context remains files only. */
export function parseSharePointSources(value: unknown): SharePointSource[] {
  return parseSelection(value, true);
}

function parseSelection(value: unknown, allowFolders: boolean): SharePointSource[] {
  if (!Array.isArray(value) || value.length > SHAREPOINT_SELECTION_LIMIT) {
    throw new Error(`Select at most ${SHAREPOINT_SELECTION_LIMIT} SharePoint documents.`);
  }
  const unique = new Map<string, SharePointSource>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") throw new Error("Invalid SharePoint document.");
    const row = candidate as Record<string, unknown>;
    if (row.kind !== undefined && row.kind !== "file" && !(allowFolders && row.kind === "folder")) {
      throw new Error("Choose individual SharePoint files for one-off context.");
    }
    if ("include_subfolders" in row || "include_descendants" in row) throw new Error("Recursive SharePoint sources are not supported.");
    if (!validSharePointId(row.drive_id) || !validSharePointId(row.item_id)) {
      throw new Error("Invalid SharePoint document identifier.");
    }
    const source: SharePointSource = {
      drive_id: row.drive_id, item_id: row.item_id,
      name: typeof row.name === "string" ? row.name.slice(0, 512) : row.item_id,
      ...(row.kind === "folder" ? { kind: "folder" as const } : row.kind === "file" ? { kind: "file" as const } : {}),
    };
    if (typeof row.web_url === "string") {
      try {
        const url = new URL(row.web_url);
        if (url.protocol === "https:" && url.hostname.endsWith(".sharepoint.com") && !url.username && !url.password) {
          source.web_url = url.toString();
        }
      } catch { /* Display metadata is optional; IDs alone identify a file. */ }
    }
    if (typeof row.size === "number" && Number.isSafeInteger(row.size) && row.size >= 0) source.size = row.size;
    unique.set(sharePointSourceKey(source), source);
  }
  return [...unique.values()];
}

/** Combine saved and per-run references without mutating either selection. */
export function mergeSharePointSelections(...selections: SharePointDocumentSource[][]): SharePointDocumentSource[] {
  const unique = new Map<string, SharePointDocumentSource>();
  for (const selection of selections) {
    for (const source of parseSharePointSelection(selection)) unique.set(sharePointSourceKey(source), source);
  }
  return parseSharePointSelection([...unique.values()]);
}
