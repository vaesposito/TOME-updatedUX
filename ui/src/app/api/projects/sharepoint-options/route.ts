import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api-error";
import { getAuthFromBearerOrSession, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { validSharePointId } from "@/lib/projects/sharepoint-source";
import { sharePointConfigured, sharePointFolderPreview, sharePointRequest } from "@/lib/tome/sharepoint";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (request: NextRequest) => {
  await getAuthFromBearerOrSession(request);
  const input = request.nextUrl.searchParams;
  const slug = input.get("project_slug");
  if (slug) requireTomeEditor(await loadTomeProject(request, slug));
  if (!sharePointConfigured()) return successResponse({ configured: false, items: [], has_more: false });
  const params = new URLSearchParams({ limit: "50" });
  const cursor = input.get("cursor");
  if (cursor) {
    if (cursor.length > 4096) throw new ApiError("Invalid cursor", 400, "INVALID_SHAREPOINT_QUERY");
    params.set("cursor", cursor);
  }
  const drive = input.get("drive_id");
  const folder = input.get("folder_item_id");
  const query = input.get("q")?.trim();
  if (input.get("preview") === "true") {
    if (!validSharePointId(drive) || !validSharePointId(folder) || query || cursor) throw new ApiError("Choose a specific folder to preview", 400, "INVALID_SHAREPOINT_QUERY");
    return successResponse(await sharePointFolderPreview({ kind: "folder", drive_id: drive, item_id: folder, name: folder }));
  }
  if (drive) {
    if (!validSharePointId(drive) || (folder && !validSharePointId(folder)) || (query && query.length > 200)) {
      throw new ApiError("Invalid SharePoint browse parameters", 400, "INVALID_SHAREPOINT_QUERY");
    }
    params.set("drive_id", drive);
    if (query) params.set("query", query);
    else if (folder) params.set("folder_item_id", folder);
  } else if (folder || query) throw new ApiError("Choose a library first", 400, "INVALID_SHAREPOINT_QUERY");
  const page = await sharePointRequest<Record<string, unknown>>(`documents/catalog/${drive ? "items" : "libraries"}`, params);
  return successResponse({ ...page, configured: true });
});
