import { mergeSharePointSelections, parseSharePointSelection, parseSharePointSources } from "../sharepoint-source";

const ref = { drive_id: "drive-1", item_id: "item-1", name: "Example.pptx" };

it("keeps folder identity only for saved sources, not one-off context", () => {
  const folder = { ...ref, kind: "folder" };
  expect(parseSharePointSources([folder])).toEqual([folder]);
  expect(() => parseSharePointSelection([folder])).toThrow("individual");
  expect(() => parseSharePointSources([{ ...folder, include_subfolders: true }])).toThrow("Recursive");
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
