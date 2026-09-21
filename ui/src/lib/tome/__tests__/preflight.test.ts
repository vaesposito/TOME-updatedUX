import { preflightRollup, preflightState, type PreflightSourceResult } from "../preflight";

const ready: PreflightSourceResult = {
  provider: "myagent", label: "MyAgent", no_token: false, accessible: [], inaccessible: [],
  unverified: ["Outlook"], connection_ready: true,
};
it("shows connected MyAgent as ready without claiming external resource verification", () => {
  expect(preflightState(ready)).toBe("ok");
  expect(ready.accessible).toEqual([]);
  expect(preflightRollup({ can_ingest: true, sources: [ready], credentials_url: "/credentials" })).toBe("ok");
});
it("still reports real connection/access failures", () => {
  expect(preflightState({ ...ready, no_token: true })).toBe("no_token");
  expect(preflightState({ ...ready, inaccessible: ["Outlook"] })).toBe("access_issue");
  expect(preflightState({ ...ready, provider: "webex" })).toBe("unverified");
});
