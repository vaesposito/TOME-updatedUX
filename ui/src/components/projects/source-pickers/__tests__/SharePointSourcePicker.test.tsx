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
    const data = query.has("preview") ? { folder, documents: [], document_count: withinLimits ? 2 : 11, total_size: 1024,
      child_folder_count: 3, unsupported_count: 1, within_limits: withinLimits, limits: { max_documents: 10, max_total_bytes: 2147483648 } }
      : { configured: true, items: query.has("drive_id")
        ? [{ id: "folder-1", name: "Example folder", folder: true }, { id: "item-1", name: "Example.pptx", supported: true, folder: false, size: 1024 }]
        : [{ id: "drive-1", name: "Documents" }], has_more: false };
    return { ok: true, json: async () => ({ data }) } as Response;
  });
});
afterEach(() => { global.fetch = originalFetch; });

it("adds only a folder reference after count/size preview, never its expanded children", async () => {
  render(<Picker />);
  fireEvent.click(await screen.findByRole("button", { name: "Documents" }));
  expect(screen.queryByRole("button", { name: "Example.pptx" })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Example folder" }));
  expect(await screen.findByText(/2 direct PDF\/PPTX document/)).toBeInTheDocument();
  expect(screen.getByText(/3 subfolder\(s\) excluded/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add this folder" }));
  expect(change).toHaveBeenLastCalledWith([folder]);
  expect(screen.getByRole("button", { name: "Folder already added" })).toBeDisabled();
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
it("disables addition when the preview exceeds limits", async () => {
  withinLimits = false;
  render(<Picker />);
  fireEvent.click(await screen.findByRole("button", { name: "Documents" }));
  fireEvent.click(await screen.findByRole("button", { name: "Example folder" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("exceeds ingestion limits");
  expect(screen.getByRole("button", { name: "Add this folder" })).toBeDisabled();
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
