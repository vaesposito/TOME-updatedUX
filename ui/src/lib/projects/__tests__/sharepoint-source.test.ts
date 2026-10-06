import { mergeSharePointSelections, parseSharePointFolderDocuments, parseSharePointSelection, parseSharePointSources } from "../sharepoint-source";

const ref = { drive_id: "drive-1", item_id: "item-1", name: "Example.pptx" };

it("validates bounded folder exclusions without discarding the captured baseline", () => {
  const source = { ...ref, kind: "folder", selected_item_ids: ["selected"], excluded_item_ids: Array.from({ length: 999 }, (_, n) => `excluded-${n}`) };
  const parsed = parseSharePointSources([source])[0];
  expect(parsed).toEqual(source);
  expect((parsed as typeof source).excluded_item_ids).not.toBe(source.excluded_item_ids);
  for (const excluded_item_ids of [["selected"], [".."], ["duplicate", "duplicate"], [...source.excluded_item_ids, "extra", "extra-2"]]) {
    expect(() => parseSharePointSources([{ ...source, excluded_item_ids }])).toThrow("exclusions");
  }
  expect(() => parseSharePointSelection([{ ...ref, excluded_item_ids: [] }])).toThrow("exclusions");
  expect(() => parseSharePointSources([{ ...ref, kind: "folder", excluded_item_ids: [] }])).toThrow("exclusions");
});

it("keeps folder identity only for saved sources, not one-off context", () => {
  const folder = { ...ref, kind: "folder" };
  expect(parseSharePointSources([folder])).toEqual([folder]);
  expect(() => parseSharePointSelection([folder])).toThrow("individual");
  expect(() => parseSharePointSources([{ ...folder, include_subfolders: true }])).toThrow("Recursive");
});

it("persists only explicit folder file IDs without silently expanding selections", () => {
  const folder = { ...ref, kind: "folder", selected_item_ids: ["file-1", "file-2"] };
  const parsed = parseSharePointSources([folder]);
  expect(parsed).toEqual([folder]);
  expect((parsed[0] as typeof folder).selected_item_ids).not.toBe(folder.selected_item_ids);
  expect(() => parseSharePointSelection([folder])).toThrow("individual");
});
it.each([[], [".."], ["file-1", "file-1"], Array.from({ length: 11 }, (_, n) => `file-${n}`), "file-1"].map((value) => [value]))("rejects invalid folder file selections: %j", (selected_item_ids) => {
  expect(() => parseSharePointSources([{ ...ref, kind: "folder", selected_item_ids }])).toThrow("1–10");
});
it("separates 500-file metadata listings from ten-file ingestion selections", () => {
  const files = Array.from({ length: 500 }, (_, n) => ({ ...ref, item_id: `file-${n}` }));
  expect(parseSharePointFolderDocuments(files)).toHaveLength(500);
  expect(() => parseSharePointSelection(files)).toThrow("at most 10");
  expect(() => parseSharePointSources([{ ...ref, selected_item_ids: ["file-1"] }])).toThrow("1–10");
});

it("deduplicates by drive and item, retaining distinct documents with the same name", () => {
  expect(parseSharePointSelection([ref, ref, { ...ref, drive_id: "drive-2" }])).toHaveLength(2);
});
it.each(["..", ".", "id/other", "https://example.test/file", "id?token=private"])("rejects invalid identifiers: %s", (item_id) => {
  expect(() => parseSharePointSelection([{ ...ref, item_id }])).toThrow("identifier");
});
it("rejects over-limit selections instead of silently truncating", () => {
  expect(() => parseSharePointSelection(Array.from({ length: 11 }, (_, n) => ({ ...ref, item_id: `item-${n}` })))).toThrow("at most 10");
});
it("does not retain tokens, route overrides, or unsafe link protocols", () => {
  expect(parseSharePointSelection([{ ...ref, token: "private", content_path: "../secret", web_url: "javascript:alert(1)" }])).toEqual([ref]);
});
it("merges per-run context with saved files without mutating or duplicating them", () => {
  const saved = [ref];
  const context = [ref, { ...ref, item_id: "item-2" }];
  expect(mergeSharePointSelections(saved, context)).toEqual([ref, context[1]]);
  expect(saved).toEqual([ref]);
  expect(context).toHaveLength(2);
});
it("enforces the total unique file limit, not the sum of duplicate inputs", () => {
  const saved = Array.from({ length: 10 }, (_, index) => ({ ...ref, item_id: `item-${index}` }));
  expect(mergeSharePointSelections(saved, saved)).toHaveLength(10);
  expect(() => mergeSharePointSelections(saved, [{ ...ref, item_id: "another-item" }])).toThrow("at most 10");
});
