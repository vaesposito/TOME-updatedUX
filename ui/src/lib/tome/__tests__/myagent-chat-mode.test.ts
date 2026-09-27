import { compatibleChatResume, requestsMyAgent } from "../myagent-chat-mode";

it.each(["can you talk to myagent to get my emails?", "Ask My Agent about the decision", "Summarize my latest emails", "Show my inbox"])(
  "recognizes explicit research request: %s", (message) => expect(requestsMyAgent(message)).toBe(true),
);
it("keeps ordinary wiki chat on its normal tools", () => {
  expect(requestsMyAgent("Explain the architecture and update the roadmap")).toBe(false);
  expect(requestsMyAgent("What is MyAgent?")).toBe(false);
  expect(requestsMyAgent("Show how email notifications work in this service")).toBe(false);
});
it("separates research and general SDK sessions in both directions", () => {
  expect(compatibleChatResume("sdk", "sdk", true, false)).toBeNull();
  expect(compatibleChatResume("sdk", "sdk", false, true)).toBeNull();
  expect(compatibleChatResume("sdk", "sdk", true, true)).toBe("sdk");
  expect(compatibleChatResume("sdk", "sdk", undefined, false)).toBe("sdk");
  expect(compatibleChatResume("foreign-sdk", "owned-sdk", false, false)).toBeNull();
});
