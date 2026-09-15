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
        name: /I authorize TOME to send MyAgent a Webex request/i,
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

  it("explains the Webex delegation, private-draft review, and connector authorization path", () => {
    render(
      <MyAgentSourcePicker
        selected={["outlook"]}
        onChange={jest.fn()}
        enabled
        onEnabledChange={jest.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: /MyAgent connector settings/i })).toHaveAttribute(
      "href",
      MYAGENT_CONNECTOR_SETTINGS_URL,
    );
    expect(screen.getByRole("link", { name: /MyAgent connector settings/i })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(
      screen.getByText(/Webex backend sends a bounded one-time request naming the selected/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/A request already sent over Webex cannot be recalled/i)).toBeInTheDocument();
    expect(screen.getByText(/restricted wiki-only follow-up pass/i)).toBeInTheDocument();
    expect(screen.getByText(/private draft with no automatic promotion/i)).toBeInTheDocument();
    expect(
      screen.getByText(/not a CAIPE-enforced provider scope/i),
    ).toBeInTheDocument();
  });
});
