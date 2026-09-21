import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MYAGENT_CONNECTOR_SETTINGS_URL } from "@/lib/projects/myagent-source";

import { MyAgentSourcePicker } from "../MyAgentSourcePicker";

describe("MyAgentSourcePicker", () => {
  it("requires a selected connector before opt-in can be enabled", () => {
    render(
      <MyAgentSourcePicker
        selected={[]}
        onChange={jest.fn()}
        enabled={false}
        onEnabledChange={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("checkbox", {
        name: /Allow TOME to query my selected sources/i,
      }),
    ).toBeDisabled();
    expect(screen.getByText(/No request will be sent until you opt in/i)).toBeInTheDocument();
  });

  it("resets opt-in when the selected capability scope changes", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const onEnabledChange = jest.fn();
    render(
      <MyAgentSourcePicker
        selected={["outlook"]}
        onChange={onChange}
        enabled
        onEnabledChange={onEnabledChange}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /Salesforce/i }));

    expect(onEnabledChange).toHaveBeenCalledWith(false);
    expect(onChange).toHaveBeenCalledWith(["outlook", "salesforce"]);
    expect(onEnabledChange.mock.invocationCallOrder[0]).toBeLessThan(
      onChange.mock.invocationCallOrder[0],
    );
  });

  it("shows source checkboxes and a small settings reminder without warning prose", () => {
    render(
      <MyAgentSourcePicker
        selected={["outlook"]}
        onChange={jest.fn()}
        enabled
        onEnabledChange={jest.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: /MyAgent settings/i })).toHaveAttribute(
      "href",
      MYAGENT_CONNECTOR_SETTINGS_URL,
    );
    expect(screen.getByRole("link", { name: /MyAgent settings/i })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByRole("checkbox", { name: /Outlook/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Salesforce/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /SharePoint/i })).not.toBeChecked();
    expect(screen.getByText(/Ingestion results stay in private drafts/i)).toBeInTheDocument();
    expect(screen.queryByText(/cannot verify|sole authorization boundary|untrusted external evidence/i)).not.toBeInTheDocument();
  });
});
