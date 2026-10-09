/** @jest-environment node */
import { checkSharePointSources, prepareManualSharePointDocuments, prepareSharePointSources, sharePointRequest, sharePointMetadata, resolveSharePointDocuments } from "../sharepoint";
import { createHash } from "crypto";

const mockListPages = jest.fn<Promise<Record<string, string>>, [string]>(async () => ({}));
jest.mock("../page-store", () => ({ getPageStore: async () => ({ listPages: (projectId: string) => mockListPages(projectId) }) }));

const ref = { drive_id: "drive-1", item_id: "item-1", name: "Example.pptx" };
const originalFetch = global.fetch;
const originalUrl = process.env.TOME_SHAREPOINT_API_URL;
const originalToken = process.env.TOME_SHAREPOINT_API_TOKEN;
beforeEach(() => {
  mockListPages.mockReset().mockResolvedValue({});
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
it("saves the explicit folder selection after validating current membership and selected size", async () => {
  global.fetch = jest.fn(async () => new Response(JSON.stringify(preview([{ ...ref, size: 100 }]))));
  const selected = { ...folder, selected_item_ids: [ref.item_id] };
  expect(await prepareSharePointSources([selected])).toEqual([{ ...selected, excluded_item_ids: [] }]);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
it("attaches an empty folder, then discovers later direct files without changing the saved selection", async () => {
  let documents: Array<typeof ref & { size: number }> = [];
  global.fetch = jest.fn(async () => new Response(JSON.stringify(preview(documents))));
  const input = { ...folder, selected_item_ids: [], excluded_item_ids: [] };
  const saved = await prepareSharePointSources([input]);
  expect(saved).toEqual([input]);
  expect(await resolveSharePointDocuments(saved)).toEqual([]);
  expect(await checkSharePointSources(saved)).toMatchObject({ inaccessible: [], detail: expect.stringContaining("0 PDF/PPTX") });
  documents = [{ ...ref, size: 100 }, { ...ref, item_id: "later-file", size: 100 }];
  expect(await resolveSharePointDocuments(saved)).toEqual(documents);
  expect(saved).toEqual([input]);
  expect(input.selected_item_ids).toEqual([]);
  expect(input.excluded_item_ids).toEqual([]);
});
it("rejects an empty initial selection if direct documents exist at save time", async () => {
  global.fetch = jest.fn(async () => new Response(JSON.stringify(preview([{ ...ref, size: 100 }]))));
  // Also covers files arriving between the browser's empty preview and the source save.
  await expect(prepareSharePointSources([{ ...folder, selected_item_ids: [], excluded_item_ids: [] }]))
    .rejects.toThrow("Refresh the folder and choose 1–10 existing files");
});
it("retains an attached empty folder without refetching or rewriting it during unrelated source saves", async () => {
  const saved = { ...folder, selected_item_ids: [], excluded_item_ids: [] };
  expect(await prepareSharePointSources([saved], [saved, ref])).toEqual([saved]);
  expect(await prepareSharePointSources([], [saved])).toEqual([]);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(saved).toEqual({ ...folder, selected_item_ids: [], excluded_item_ids: [] });
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
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ ...preview(Array.from({ length: 11 }, (_, n) => ({ ...ref, item_id: `file-${n}`, size: 100 }))), within_limits: false })));
  await expect(resolveSharePointDocuments([folder])).rejects.toThrow("exceeds the limit");
  await expect(prepareSharePointSources([folder])).rejects.toThrow("Choose 1–10 existing files");
});

it("allows selecting ten files out of a 500-file folder without ingesting the other 490", async () => {
  const documents = Array.from({ length: 500 }, (_, n) => ({ ...ref, item_id: `file-${n}`, size: 100 }));
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ ...preview(documents), within_limits: false })));
  const selected = { ...folder, selected_item_ids: documents.slice(490).map((file) => file.item_id) };
  const saved = await prepareSharePointSources([selected]);
  expect(saved).toEqual([{ ...selected, excluded_item_ids: documents.slice(0, 490).map((file) => file.item_id) }]);
  expect(await resolveSharePointDocuments(saved)).toEqual(documents.slice(490));
});
it("future runs include later additions and changes but exclude unchecked existing IDs", async () => {
  const selected = { ...folder, selected_item_ids: [ref.item_id], excluded_item_ids: ["old-unselected"] };
  let revision = 0;
  global.fetch = jest.fn(async () => new Response(JSON.stringify(preview([
    { ...ref, name: `Changed-${++revision}.pptx`, size: 100 }, { ...ref, item_id: `new-${revision}`, size: 100 },
    { ...ref, item_id: "old-unselected", name: "Changed unchecked file.pptx", size: 100 },
  ]))));
  expect(await resolveSharePointDocuments([selected])).toEqual([{ ...ref, name: "Changed-1.pptx", size: 100 }, { ...ref, item_id: "new-1", size: 100 }]);
  expect(await resolveSharePointDocuments([selected])).toEqual([{ ...ref, name: "Changed-2.pptx", size: 100 }, { ...ref, item_id: "new-2", size: 100 }]);
  expect(selected.selected_item_ids).toEqual([ref.item_id]);
});
it("supports explicit file selection edits but does not migrate retained legacy folders", async () => {
  const documents = [{ ...ref, size: 100 }, { ...ref, item_id: "item-2", size: 100 }];
  global.fetch = jest.fn(async () => new Response(JSON.stringify(preview(documents))));
  expect(await prepareSharePointSources([folder], [folder])).toEqual([folder]);
  expect(global.fetch).not.toHaveBeenCalled();
  const first = { ...folder, selected_item_ids: [ref.item_id] };
  expect(await prepareSharePointSources([first], [folder])).toEqual([{ ...first, excluded_item_ids: ["item-2"] }]);
  const second = { ...folder, selected_item_ids: ["item-2"] };
  expect(await prepareSharePointSources([second], [first])).toEqual([{ ...second, excluded_item_ids: [ref.item_id] }]);
  await expect(prepareSharePointSources([folder], [second])).rejects.toThrow("Choose 1–10 existing files");
});

function summary(file: typeof ref & { version: string }, kind = "dynamic", body = "Document summary") {
  const key = "doc-" + createHash("sha256").update(JSON.stringify([file.drive_id, file.item_id])).digest("hex").slice(0, 24);
  const version = "sha256:" + createHash("sha256").update(file.version).digest("hex");
  return { [`sharepoint/${key}.md`]: `---\nkind: ${kind}\nsource_provider: sharepoint\nsource_document_key: ${key}\nsource_version: ${version}\n---\n${body}` };
}
it("ten previously ingested files do not block a new folder file, which is skipped after successful ingestion", async () => {
  const initial = Array.from({ length: 10 }, (_, n) => ({ ...ref, item_id: `file-${n}`, size: 100, version: `version-${n}` }));
  const selected = { ...folder, selected_item_ids: initial.map((file) => file.item_id), excluded_item_ids: ["unchecked"] };
  const added = { ...ref, item_id: "new-file", size: 100, version: "new-version" };
  const documents = [...initial, added, { ...added, item_id: "unchecked" }];
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ ...preview(documents), within_limits: false })));
  const existingPages = Object.assign({}, ...initial.map((file) => summary(file)));
  expect(await resolveSharePointDocuments([selected], [], { existingPages })).toEqual([added]);
  expect(await resolveSharePointDocuments([selected], [], { existingPages: { ...existingPages, ...summary(added) } })).toEqual([]);
  initial[0].version = "changed-version";
  expect(await resolveSharePointDocuments([selected], [], { existingPages: { ...existingPages, ...summary(added) } })).toEqual([initial[0]]);
  expect(selected).toEqual({ ...folder, selected_item_ids: initial.map((file) => file.item_id), excluded_item_ids: ["unchecked"] });
  expect(global.fetch).toHaveBeenCalledTimes(3); // Listings only; no file downloads or per-file requests.
});
it("counts only pending bytes, preserves protected summaries, and does not treat an empty summary as ingested", async () => {
  const unchanged = { ...ref, size: 5000, version: "v1" };
  const protectedFile = { ...ref, item_id: "protected", size: 5000, version: "changed" };
  const added = { ...ref, item_id: "new-file", size: 100, version: "v1" };
  const selected = { ...folder, selected_item_ids: [ref.item_id], excluded_item_ids: [] };
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ ...preview([unchanged, protectedFile, added]), within_limits: false })));
  const existingPages = { ...summary(unchanged), ...summary(protectedFile, "stable"), ...summary(added, "dynamic", "") };
  expect(await resolveSharePointDocuments([selected], [], { existingPages })).toEqual([added]);
});
it("over ten new/changed files fails explicitly without truncation, selection rewrites or arbitrary backfill", async () => {
  const documents = Array.from({ length: 11 }, (_, n) => ({ ...ref, item_id: `file-${n}`, size: 100, version: "v1" }));
  const selected = { ...folder, selected_item_ids: ["file-0"], excluded_item_ids: [] };
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ ...preview(documents), within_limits: false })));
  await expect(resolveSharePointDocuments([selected], [], { existingPages: {} })).rejects.toThrow("No partial batch was started");
  expect(selected.excluded_item_ids).toEqual([]);
});
it("canonicalizes exclusions server-side and requires explicit saving to enable additions for old fixed selections", async () => {
  const original = { ...folder, selected_item_ids: [ref.item_id] };
  global.fetch = jest.fn(async () => new Response(JSON.stringify(preview([{ ...ref, size: 100 }, { ...ref, item_id: "unchecked", size: 100 }]))));
  expect(await prepareSharePointSources([original], [original])).toEqual([original]);
  expect(global.fetch).not.toHaveBeenCalled();
  const saved = await prepareSharePointSources([{ ...original, excluded_item_ids: ["forged"] }], [original]);
  expect(saved).toEqual([{ ...original, excluded_item_ids: ["unchecked"] }]);
  expect(original).not.toHaveProperty("excluded_item_ids");
});
it("preflight and one-off submit use persisted summaries without mutating project sources", async () => {
  const documents = Array.from({ length: 10 }, (_, n) => ({ ...ref, item_id: `file-${n}`, size: 100, version: "v1" }));
  const selected = { ...folder, selected_item_ids: documents.map((file) => file.item_id), excluded_item_ids: [] };
  const added = { ...ref, item_id: "one-off", size: 100, version: "v1" };
  mockListPages.mockResolvedValue(Object.assign({}, ...documents.map((file) => summary(file))));
  global.fetch = jest.fn(async (url) => new Response(JSON.stringify(new URL(String(url)).pathname.endsWith("/metadata")
    ? added : { ...preview([...documents, added]), within_limits: false })));
  expect(await checkSharePointSources([selected], "example-project")).toMatchObject({ inaccessible: [], detail: expect.stringContaining("1 PDF/PPTX") });
  expect(await prepareManualSharePointDocuments([added], [selected], "example-project")).toEqual([added]);
  expect(mockListPages).toHaveBeenCalledWith("example-project");
  expect(selected.excluded_item_ids).toEqual([]);
});
it("fails explicitly if a selected file moves, disappears or becomes unsupported; never substitutes another file", async () => {
  global.fetch = jest.fn(async () => new Response(JSON.stringify(preview([{ ...ref, item_id: "replacement", size: 100 }]))));
  await expect(resolveSharePointDocuments([{ ...folder, selected_item_ids: [ref.item_id] }])).rejects.toThrow("No replacement files were selected");
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
