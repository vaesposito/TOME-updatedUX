import { fireEvent, render, screen } from "@testing-library/react";

import { SourcesEditor } from "../SourcesEditor";

let mockMyAgentEnabled: boolean | null = false;
jest.mock("@/hooks/use-myagent-enabled", () => ({
  useMyAgentEnabled: () => mockMyAgentEnabled,
}));
jest.mock("../MyAgentSourcePicker", () => ({
  MyAgentSourcePicker: () => <div>Delegated source picker</div>,
}));
jest.mock("../SharePointSourcePicker", () => ({
  SharePointSourcePicker: ({ onChange }: { onChange: (next: unknown[]) => void }) => (
    <button onClick={() => onChange([{ drive_id: "drive-1", item_id: "folder-1", kind: "folder" }])}>
      Choose SharePoint folder
    </button>
  ),
}));

it.each([null, false, true])("keeps SharePoint available while gating MyAgent (enabled=%s)", (enabled) => {
  mockMyAgentEnabled = enabled;
  const onChange = jest.fn();
  const sources = { repos: ["https://github.com/example/repo"] };
  render(<SourcesEditor kinds={["sharepoint", "myagent"]} value={sources} onChange={onChange} />);

  const sharePointPicker = screen.getByRole("button", { name: "Choose SharePoint folder" });
  if (enabled) {
    expect(screen.getByText("Delegated source picker")).toBeInTheDocument();
  } else {
    expect(screen.queryByText("Delegated source picker")).not.toBeInTheDocument();
  }
  fireEvent.click(sharePointPicker);
  expect(onChange).toHaveBeenCalledWith({
    ...sources,
    sharepoint_documents: [{ drive_id: "drive-1", item_id: "folder-1", kind: "folder" }],
  });
});
