/** @jest-environment node */
import { checkSharePointSources, prepareManualSharePointDocuments, prepareSharePointSources, sharePointRequest, sharePointMetadata, resolveSharePointDocuments } from "../sharepoint";

const ref = { drive_id: "drive-1", item_id: "item-1", name: "Example.pptx" };
const originalFetch = global.fetch;
const originalUrl = process.env.TOME_SHAREPOINT_API_URL;
const originalToken = process.env.TOME_SHAREPOINT_API_TOKEN;
beforeEach(() => {
  process.env.TOME_SHAREPOINT_API_URL = "http://sharepoint.example.test:8000";
  process.env.TOME_SHAREPOINT_API_TOKEN = "test-service-token";
  global.fetch = jest.fn(async () => new Response(JSON.stringify(ref), { status: 200 }));
});
afterEach(() => {
  global.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.TOME_SHAREPOINT_API_URL; else process.env.TOME_SHAREPOINT_API_URL = originalUrl;
  if (originalToken === undefined) delete process.env.TOME_SHAREPOINT_API_TOKEN; else process.env.TOME_SHAREPOINT_API_TOKEN = originalToken;
});
it("authenticates only to the configured MCP; never follows redirects", async () => {
  await sharePointMetadata(ref);
  expect(global.fetch).toHaveBeenCalledWith(new URL("http://sharepoint.example.test:8000/documents/drive-1/item-1/metadata"),
    expect.objectContaining({ headers: { Authorization: "Bearer test-service-token", Accept: "application/json" }, redirect: "error", cache: "no-store" }));
});
it("validates newly attached files but never repairs or refetches retained references during removal", async () => {
  expect(await prepareSharePointSources([ref], [ref])).toEqual([ref]);
  expect(await prepareSharePointSources([], [ref])).toEqual([]);
  expect(global.fetch).not.toHaveBeenCalled();
});
it("rejects traversal before making requests", async () => {
  await expect(prepareSharePointSources([{ ...ref, item_id: ".." }])).rejects.toThrow("identifier");
  expect(global.fetch).not.toHaveBeenCalled();
});
it("reports app access failures without prompting personal OAuth or exposing provider errors", async () => {
  global.fetch = jest.fn(async () => new Response("private provider details", { status: 403 }));
  expect(await checkSharePointSources([ref])).toMatchObject({ no_token: false, fixable_by_user: false, inaccessible: [ref.name] });
  await expect(sharePointRequest("documents/catalog/libraries")).rejects.toThrow("Contact an administrator");
});
it("fails closed when service credentials are not configured", async () => {
  delete process.env.TOME_SHAREPOINT_API_TOKEN;
  await expect(sharePointRequest("documents/catalog/libraries")).rejects.toThrow("not configured");
  expect(global.fetch).not.toHaveBeenCalled();
});
it("freshly validates one-off context even when its reference was already saved", async () => {
  const saved = [ref];
  expect(await prepareManualSharePointDocuments([{ ...ref, name: "Untrusted name" }], saved)).toEqual([ref]);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(saved).toEqual([ref]);
});
it("does no work when one-off context is absent or empty", async () => {
  expect(await prepareManualSharePointDocuments(undefined)).toBeUndefined();
  expect(await prepareManualSharePointDocuments([])).toEqual([]);
  expect(global.fetch).not.toHaveBeenCalled();
});
it("rejects the combined limit before making any provider calls", async () => {
  const saved = Array.from({ length: 10 }, (_, index) => ({ ...ref, item_id: `item-${index}` }));
  await expect(prepareManualSharePointDocuments([{ ...ref, item_id: "extra-item" }], saved)).rejects.toThrow("at most 10");
  expect(global.fetch).not.toHaveBeenCalled();
});
it("bounds a context preflight to two concurrent metadata requests", async () => {
  let active = 0;
  let maxActive = 0;
  global.fetch = jest.fn(async (url) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active -= 1;
    const item_id = new URL(String(url)).pathname.split("/").at(-2);
    return new Response(JSON.stringify({ ...ref, item_id }));
  });
  const refs = Array.from({ length: 5 }, (_, index) => ({ ...ref, item_id: `context-${index}` }));
  expect(await prepareManualSharePointDocuments(refs)).toEqual(refs);
  expect(maxActive).toBe(2);
  expect(global.fetch).toHaveBeenCalledTimes(5);
});

const folder = { kind: "folder" as const, drive_id: "drive-1", item_id: "folder-1", name: "Example folder" };
function preview(documents: Array<typeof ref & { size: number }>) {
  return { folder, documents, document_count: documents.length, total_size: documents.reduce((sum, file) => sum + file.size, 0),
    child_folder_count: 1, unsupported_count: 0, within_limits: true, limits: { max_documents: 10, max_total_bytes: 2048 } };
}
it("blocks new persistent files but retains old ones unchanged", async () => {
  await expect(prepareSharePointSources([ref])).rejects.toThrow("single PDF");
  expect(await prepareSharePointSources([ref], [ref])).toEqual([ref]);
  expect(global.fetch).not.toHaveBeenCalled();
});
it("saves only the folder reference after validating count and total size", async () => {
  global.fetch = jest.fn(async () => new Response(JSON.stringify(preview([{ ...ref, size: 100 }]))));
  expect(await prepareSharePointSources([folder])).toEqual([folder]);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
it("freshly resolves new folder contents on every run without rewriting sources", async () => {
  let revision = 0;
  global.fetch = jest.fn(async () => new Response(JSON.stringify(preview([{ ...ref, item_id: `file-${++revision}`, size: 100 }]))));
  const sources = [folder];
  expect(await resolveSharePointDocuments(sources)).toEqual([{ ...ref, item_id: "file-1", size: 100 }]);
  expect(await resolveSharePointDocuments(sources)).toEqual([{ ...ref, item_id: "file-2", size: 100 }]);
  expect(sources).toEqual([folder]);
});
it("deduplicates a file present in a folder and one-off context", async () => {
  global.fetch = jest.fn(async () => new Response(JSON.stringify(preview([{ ...ref, size: 100 }]))));
  expect(await resolveSharePointDocuments([folder], [ref])).toEqual([{ ...ref, size: 100 }]);
});
it("rejects an oversized folder instead of ingesting a truncated set", async () => {
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ ...preview([]), document_count: 11, within_limits: false })));
  await expect(resolveSharePointDocuments([folder])).rejects.toThrow("exceeds the limit");
  await expect(prepareSharePointSources([folder])).rejects.toThrow("exceeds the limit");
});
it("enforces combined unique file and byte limits across folders", async () => {
  global.fetch = jest.fn(async (url) => {
    const item_id = new URL(String(url)).pathname.split("/").at(-2);
    return new Response(JSON.stringify({ ...preview(Array.from({ length: 6 }, (_, n) => ({ ...ref, item_id: `${item_id}-file-${n}`, size: 100 }))), folder: { ...folder, item_id } }));
  });
  await expect(resolveSharePointDocuments([folder, { ...folder, item_id: "folder-2" }])).rejects.toThrow("more than 10 unique");
  global.fetch = jest.fn(async (url) => {
    const item_id = new URL(String(url)).pathname.split("/").at(-2);
    return new Response(JSON.stringify({ ...preview([{ ...ref, item_id: `${item_id}-file`, size: 1500 }]), folder: { ...folder, item_id } }));
  });
  await expect(resolveSharePointDocuments([folder, { ...folder, item_id: "folder-2" }])).rejects.toThrow("total size limit");
});
