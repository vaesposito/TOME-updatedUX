/** Stream published Markdown into a private retrieval view, never the ingest workspace. */
import { createHash } from "crypto";

import { ApiError } from "@/lib/api-middleware";
import { canReadTomeProject, isTomeAdminSubject } from "./access";
import { resolveProject } from "./internal-api";
import { getPageStore, safePagePath, type PageStore, type PublishedPageSnapshot } from "./page-store";
import { buildTomeRetrievalScope } from "./retrieval-scope";

const MAX_CORPUS_BYTES = 64 * 1024 * 1024;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 20_000;

async function* publishedPages(store: PageStore, projectId: string): AsyncIterable<PublishedPageSnapshot> {
  if (store.publishedPages) {
    yield* store.publishedPages(projectId);
    return;
  }
  // Backends without revision metadata still use the canonical published reader.
  const pages = await store.listPages(projectId);
  for (const path of Object.keys(pages).sort()) yield { path, markdown: pages[path] };
}

export function publishedTomeSnapshotResponse(
  subject: string,
  scope: Awaited<ReturnType<typeof buildTomeRetrievalScope>>,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  const checkCancelled = () => {
    if (cancelled || signal.aborted) throw new Error("Snapshot cancelled");
  };
  async function* frames(): AsyncGenerator<Record<string, unknown>> {
    try {
      checkCancelled();
      yield { type: "catalog", version: 1, scope_hash: scope.hash, catalog: scope.catalog, captured_at: new Date().toISOString() };
      const store = await getPageStore();
      const hash = createHash("sha256");
      let pageCount = 0;
      let totalBytes = 0;
      for (const entry of scope.catalog) {
        checkCancelled();
        const project = await resolveProject(entry.project_id);
        if (!await isTomeAdminSubject(subject) && !await canReadTomeProject(subject, project)) {
          throw new ApiError("TOME access changed during context preparation", 409, "TOME_SCOPE_CHANGED");
        }
        for await (const page of publishedPages(store, project._id)) {
          checkCancelled();
          const path = safePagePath(page.path);
          if (path.length > 1024 || /[\\\x00-\x1f]/.test(path)) {
            throw new ApiError("Published page has an unsupported path", 422, "TOME_PAGE_PATH_INVALID");
          }
          const bytes = Buffer.byteLength(page.markdown, "utf8");
          totalBytes += bytes;
          pageCount += 1;
          if (bytes > MAX_PAGE_BYTES) {
            throw new ApiError("A published page exceeds the 8 MiB retrieval limit", 413, "TOME_CONTEXT_TOO_LARGE");
          }
          if (totalBytes > MAX_CORPUS_BYTES || pageCount > MAX_PAGES) {
            throw new ApiError("Published corpus exceeds the 64 MiB / 20,000 page retrieval limit", 413, "TOME_CONTEXT_TOO_LARGE");
          }
          const contentHash = createHash("sha256").update(page.markdown).digest("hex");
          hash.update(JSON.stringify([entry.project_id, path, contentHash, page.revision_id ?? ""]));
          yield {
            type: "page", project_id: entry.project_id, project_slug: entry.slug, path,
            markdown: page.markdown, content_hash: contentHash, revision_id: page.revision_id,
            updated_at: page.updated_at, captured_at: new Date().toISOString(),
          };
        }
      }
      checkCancelled();
      // No model uses the staged bodies until this final current-access check succeeds.
      if ((await buildTomeRetrievalScope(subject)).hash !== scope.hash) {
        throw new ApiError("TOME access changed during context preparation", 409, "TOME_SCOPE_CHANGED");
      }
      yield { type: "done", scope_hash: scope.hash, page_count: pageCount, total_bytes: totalBytes,
        corpus_hash: hash.digest("hex"), completed_at: new Date().toISOString() };
    } catch (error: unknown) {
      if (cancelled || signal.aborted) return;
      console.warn("[TOME retrieval snapshot] Preparation failed", error instanceof ApiError ? error.code : "SNAPSHOT_FAILED");
      yield { type: "error", code: error instanceof ApiError ? error.code : "SNAPSHOT_FAILED",
        message: error instanceof ApiError ? error.message : "TOME context preparation failed" };
    }
  }
  const iterator = frames();
  const stream = new ReadableStream<Uint8Array>({
    async pull(output) {
      const next = await iterator.next();
      if (cancelled) return;
      if (next.done) output.close();
      else output.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
    },
    async cancel() {
      cancelled = true;
      await iterator.return(undefined);
    },
  });
  return new Response(stream, { headers: {
    "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no",
  } });
}
