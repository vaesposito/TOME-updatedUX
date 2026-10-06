import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { SharePointSource } from "@/types/projects";
import { SharePointSourcePicker, SharePointDocumentBrowser } from "../SharePointSourcePicker";

// Shared listbox interactions are tested beside SearchablePicker; this covers source persistence.
jest.mock("@/components/ui/searchable-picker", () => ({ SearchablePicker: (props: {
  options: Array<{ id: string; name: string }>; onSelect: (item: { id: string; name: string }) => void;
  isOptionDisabled?: (item: { id: string; name: string }) => boolean;
  hasMore?: boolean; onLoadMore?: () => void;
}) => <div>{props.options.map((item) => <button key={item.id} disabled={props.isOptionDisabled?.(item)} onClick={() => props.onSelect(item)}>{item.name}</button>)}
  {props.hasMore && <button onClick={props.onLoadMore}>Load more</button>}</div> }));
jest.mock("@/components/ui/multi-select", () => ({ MultiSelect: (props: {
  options: string[]; selected: string[]; onChange: (ids: string[]) => void; formatOption: (id: string) => string;
}) => <div>{props.options.map((id) => <label key={id}><input type="checkbox" checked={props.selected.includes(id)}
  onChange={() => props.onChange(props.selected.includes(id) ? props.selected.filter((value) => value !== id) : [...props.selected, id])} />{props.formatOption(id)}</label>)}</div> }));

const originalFetch = global.fetch;
const change = jest.fn();
const folder = { kind: "folder" as const, drive_id: "drive-1", item_id: "folder-1", name: "Example folder" };
let withinLimits = true;
function Picker() {
  const [selected, setSelected] = useState<SharePointSource[]>([]);
  return <SharePointSourcePicker selected={selected} projectSlug="example-project" onChange={(next) => { setSelected(next); change(next); }} />;
}
beforeEach(() => {
  change.mockReset();
  withinLimits = true;
  global.fetch = jest.fn(async (url) => {
    const query = new URL(String(url), "http://example.test").searchParams;
    const documents = Array.from({ length: withinLimits ? 2 : 16 }, (_, n) => ({ drive_id: "drive-1", item_id: `file-${n}`, name: `Selected-${n}.pdf`, size: 512 }));
    const data = query.has("preview") ? { folder, documents, document_count: documents.length, total_size: documents.length * 512,
      child_folder_count: 3, unsupported_count: 1, within_limits: withinLimits, limits: { max_documents: 10, max_total_bytes: 2147483648 } }
      : { configured: true, items: query.has("drive_id")
        ? [{ id: "folder-1", name: "Example folder", folder: true }, { id: "item-1", name: "Example.pptx", supported: true, folder: false, size: 1024 }]
        : [{ id: "drive-1", name: "Documents" }], has_more: false };
    return { ok: true, json: async () => ({ data }) } as Response;
  });
});
afterEach(() => { global.fetch = originalFetch; });

it("saves the initial batch and excludes unchecked existing files while including future additions", async () => {
  render(<Picker />);
  fireEvent.click(await screen.findByRole("button", { name: "Documents" }));
  expect(screen.queryByRole("button", { name: "Example.pptx" })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Example folder" }));
  expect(await screen.findByText(/2 direct PDF\/PPTX document/)).toBeInTheDocument();
  expect(screen.getByText(/3 subfolder\(s\) excluded/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add this folder" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /Selected-0.pdf/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add this folder" }));
  expect(change).toHaveBeenLastCalledWith([{ ...folder, selected_item_ids: ["file-0"], excluded_item_ids: ["file-1"] }]);
  expect(screen.getByText(/for the initial ingest\. Future runs also include new files/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save file selection" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Remove Example folder" }));
  expect(change).toHaveBeenLastCalledWith([]);
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("project_slug=example-project"), expect.anything());
});
it("keeps the source card layout and links individual-file ingestion to Run ingest", () => {
  render(<Picker />);
  const card = screen.getByRole("region", { name: "SharePoint source" });
  expect(card).toHaveClass("overflow-hidden", "rounded-2xl", "border-border", "bg-card");
  const heading = within(card).getByRole("heading", { level: 3, name: "SharePoint source" });
  expect(heading.parentElement?.querySelector("img")).toHaveAttribute("src", "/provider-logos/sharepoint.svg");
  expect(within(card).getByRole("region", { name: "Selected SharePoint sources" })).toHaveClass("px-4", "py-4");
  expect(within(card).getByRole("region", { name: "Add a SharePoint folder" })).toHaveClass("border-t", "px-4", "py-4");
  expect(within(card).getByRole("link", { name: /Run ingest/ })).toHaveAttribute("href", "/projects/example-project/tome/ingest");
  expect(within(card).getByText(/SharePoint site pages are not supported yet/)).toBeInTheDocument();
});
it("allows a large folder with ten initial files and excludes the existing unchecked files", async () => {
  withinLimits = false;
  render(<Picker />);
  fireEvent.click(await screen.findByRole("button", { name: "Documents" }));
  fireEvent.click(await screen.findByRole("button", { name: "Example folder" }));
  expect(await screen.findByText(/16 direct PDF\/PPTX document/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add this folder" })).toBeDisabled();
  for (let n = 0; n < 10; n++) fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(`Selected-${n}\\.pdf`) }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Selected-10.pdf/ }));
  expect(screen.getByRole("alert")).toHaveTextContent("Select at most 10 files");
  expect(screen.getByRole("checkbox", { name: /Selected-10.pdf/ })).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Add this folder" }));
  expect(change).toHaveBeenLastCalledWith([{ ...folder, selected_item_ids: Array.from({ length: 10 }, (_, n) => `file-${n}`),
    excluded_item_ids: Array.from({ length: 6 }, (_, n) => `file-${n + 10}`) }]);
});
it("reopens saved selections and changes them only after Save file selection", async () => {
  const saved = { ...folder, selected_item_ids: ["file-0"] };
  render(<SharePointSourcePicker selected={[saved]} onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Choose files in Example folder" }));
  expect(await screen.findByRole("checkbox", { name: /Selected-0.pdf/ })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Selected-1.pdf/ })).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: /Selected-1.pdf/ }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save file selection" }));
  expect(change).toHaveBeenCalledWith([{ ...folder, selected_item_ids: ["file-0", "file-1"], excluded_item_ids: [] }]);
  expect(saved.selected_item_ids).toEqual(["file-0"]);
});
it("does not silently widen a previously saved fixed selection; an explicit save enables future additions", async () => {
  const saved = { ...folder, selected_item_ids: ["file-0"] };
  render(<SharePointSourcePicker selected={[saved]} onChange={change} />);
  expect(screen.getByText(/Previously saved fixed selection/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Choose files in Example folder" }));
  expect(await screen.findByRole("checkbox", { name: /Selected-0.pdf/ })).toBeChecked();
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save file selection" }));
  expect(change).toHaveBeenCalledWith([{ ...folder, selected_item_ids: ["file-0"], excluded_item_ids: ["file-1"] }]);
  expect(saved).not.toHaveProperty("excluded_item_ids");
});
it("preserves unavailable selected IDs for explicit removal instead of replacing them", async () => {
  render(<SharePointSourcePicker selected={[{ ...folder, selected_item_ids: ["removed-file"] }]} onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Choose files in Example folder" }));
  expect(await screen.findByRole("checkbox", { name: /Unavailable selected file/ })).toBeChecked();
  expect(screen.getByRole("button", { name: "Save file selection" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: /Selected-0.pdf/ })).not.toBeChecked();
  expect(change).not.toHaveBeenCalled();
});
it("preserves legacy files and supports removal without migration", () => {
  const legacy = { drive_id: "drive-1", item_id: "item-1", name: "Example.pdf" };
  render(<SharePointSourcePicker selected={[legacy]} onChange={change} />);
  expect(screen.getByText("Previously attached individual file")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove Example.pdf" }));
  expect(change).toHaveBeenCalledWith([]);
});
it("renders saved sources read-only without browsing the service", () => {
  render(<SharePointSourcePicker readOnly selected={[folder]} onChange={change} />);
  expect(screen.getByText("Example folder")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Add a SharePoint folder" })).not.toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});
it("keeps individual PDF/PPTX selection available in the one-off browser", async () => {
  render(<SharePointDocumentBrowser selected={[]} onChange={change} projectSlug="example-project" />);
  fireEvent.click(await screen.findByRole("button", { name: "Documents" }));
  fireEvent.click(await screen.findByRole("button", { name: "Example.pptx" }));
  expect(change).toHaveBeenCalledWith([{ drive_id: "drive-1", item_id: "item-1", name: "Example.pptx", size: 1024 }]);
});
