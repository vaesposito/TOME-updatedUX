import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IngestPanel } from "../IngestPanel";

let mockMyAgentEnabled = false;
jest.mock("@/hooks/use-myagent-enabled", () => ({ useMyAgentEnabled: () => mockMyAgentEnabled }));
jest.mock("@/components/tome/BhagProjectsPanel", () => ({ ChildProjectsPanel: () => null }));
// The domain/browser tests own ID selection; shared listbox behavior has its own suite.
jest.mock("@/components/ui/searchable-picker", () => ({ SearchablePicker: (props: {
  options: Array<{ id: string; name: string }>; onSelect: (item: { id: string; name: string }) => void;
  disabled?: boolean; isOptionDisabled?: (item: { id: string; name: string }) => boolean;
}) => <div>{props.options.map((item) => <button key={item.id}
  disabled={props.disabled || props.isOptionDisabled?.(item)} onClick={() => props.onSelect(item)}>{item.name}</button>)}</div> }));

const originalFetch = global.fetch;
const saved = { drive_id: "drive-1", item_id: "saved", name: "Saved.pdf" };
const context = { drive_id: "drive-1", item_id: "context", name: "Context.pptx", size: 1024 };
const onRunStarted = jest.fn();
let submitFails = false;
let savedDocuments = [saved];

beforeEach(() => {
  mockMyAgentEnabled = false;
  submitFails = false;
  savedDocuments = [saved];
  onRunStarted.mockReset();
  global.fetch = jest.fn(async (url) => {
    const path = String(url);
    const submit = /\/(reingest|synthesize)$/.test(path);
    const data = path.includes("/sharepoint-options")
      ? { configured: true, items: path.includes("drive_id=") ? [
        { id: "saved", name: saved.name, supported: true }, { id: "context", name: context.name, supported: true, size: 1024 },
      ] : [{ id: "drive-1", name: "Documents" }], has_more: false }
      : path.includes("/webex-meetings") ? { meetings: [{ id: "meeting-1", title: "Example meeting", start: "2026-01-01T10:00:00Z", hasTranscript: true, hasSummary: false }] }
      : submit ? { runId: "new-run" }
      : { project: { slug: "example", sources: { sharepoint_documents: savedDocuments } }, sources: [],
        runs: [{ id: "previous-run", status: "succeeded", started_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:01:00Z", log_lines: 0, error: null }] };
    return { ok: !submit || !submitFails, json: async () => submit && submitFails
      ? { error: "Document access failed" } : { data } } as Response;
  });
});
afterEach(() => { global.fetch = originalFetch; });

function panel(isSynthesized = false, canEdit = true) {
  return render(<IngestPanel slug="example" canEdit={canEdit} isSynthesized={isSynthesized}
    onRunStarted={onRunStarted} onOpenRun={jest.fn()} onReviewDraft={jest.fn()} />);
}
async function chooseContext() {
  fireEvent.click(screen.getByRole("button", { name: /Add context: SharePoint documents/ }));
  const section = screen.getByRole("region", { name: "SharePoint context" });
  fireEvent.click(await within(section).findByRole("button", { name: "Documents" }));
  expect(within(section).queryByRole("button", { name: saved.name })).not.toBeInTheDocument();
  fireEvent.click(await within(section).findByRole("button", { name: context.name }));
  return section;
}
function submittedBody(endpoint: string) {
  const call = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).endsWith(`/${endpoint}`));
  return JSON.parse(call[1].body);
}

it.each([
  [false, false], [false, true], [true, false], [true, true],
])("submits per-run context without saving project sources (synthesized=%s, MyAgent=%s)", async (isSynthesized, myAgentEnabled) => {
  mockMyAgentEnabled = myAgentEnabled;
  panel(isSynthesized);
  expect((global.fetch as jest.Mock).mock.calls.some(([url]) => String(url).includes("sharepoint-options"))).toBe(false);
  const section = await chooseContext();
  expect(within(section).getByText(/not saved to the project or included in future auto-ingests/)).toBeInTheDocument();
  expect(within(section).getByRole("list", { name: "SharePoint documents for this run" })).toHaveTextContent(context.name);
  fireEvent.click(screen.getByRole("button", { name: isSynthesized ? "Ingest & synthesize" : "Run ingest" }));
  await waitFor(() => expect(onRunStarted).toHaveBeenCalledWith("new-run"));
  expect(submittedBody(isSynthesized ? "synthesize" : "reingest").sharepointDocuments).toEqual([context]);
  expect(savedDocuments).toEqual([saved]);
  expect((global.fetch as jest.Mock).mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(false);
  expect(within(section).queryByRole("list", { name: "SharePoint documents for this run" })).not.toBeInTheDocument();
});

it("retains selections after submit fails and allows removing them", async () => {
  submitFails = true;
  panel();
  const section = await chooseContext();
  fireEvent.click(screen.getByRole("button", { name: "Run ingest" }));
  expect(await screen.findByText("Document access failed")).toBeInTheDocument();
  expect(within(section).getByRole("list", { name: "SharePoint documents for this run" })).toHaveTextContent(context.name);
  fireEvent.click(within(section).getByRole("button", { name: `Remove context document ${context.name}` }));
  expect(within(section).queryByRole("list", { name: "SharePoint documents for this run" })).not.toBeInTheDocument();
});

it("excludes one-off documents when switching to meeting-only ingest", async () => {
  panel();
  await chooseContext();
  fireEvent.click(screen.getByRole("button", { name: "Ingest meeting" }));
  expect(screen.queryByRole("region", { name: "SharePoint context" })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.click(screen.getAllByRole("button", { name: "Ingest meeting" }).at(-1)!);
  await waitFor(() => expect(onRunStarted).toHaveBeenCalledWith("new-run"));
  expect(submittedBody("reingest")).toMatchObject({ sourceScope: "webex_meetings" });
  expect(submittedBody("reingest")).not.toHaveProperty("sharepointDocuments");
});

it("counts saved files towards the per-run limit", async () => {
  savedDocuments = Array.from({ length: 10 }, (_, index) => ({ ...saved, item_id: `saved-${index}` }));
  panel();
  fireEvent.click(screen.getByRole("button", { name: /Add context: SharePoint documents/ }));
  const section = screen.getByRole("region", { name: "SharePoint context" });
  fireEvent.click(await within(section).findByRole("button", { name: "Documents" }));
  expect(await within(section).findByRole("button", { name: context.name })).toBeDisabled();
});

it("does not browse or select files for a view-only user", async () => {
  panel(false, false);
  fireEvent.click(screen.getByRole("button", { name: /Add context: SharePoint documents/ }));
  await screen.findByText(saved.name);
  expect(screen.getByRole("button", { name: "Run ingest" })).toBeDisabled();
  expect((global.fetch as jest.Mock).mock.calls.some(([url]) => String(url).includes("sharepoint-options"))).toBe(false);
});
