/** @jest-environment node */
const mockList = jest.fn();
const mockRefresh = jest.fn();
const mockConnectors = jest.fn();
jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getProviderConnectionService: async () => ({ listConnections: mockList, refreshConnection: mockRefresh }),
  getOAuthConnectorService: async () => ({ listConnectors: mockConnectors }),
}));
import { personalWebexSpaceToken, webexSpaceConnectionLabel, webexSpaceProvider } from "../webex-space-provider";

const original = process.env.TOME_WEBEX_SPACE_PROVIDER;
beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.TOME_WEBEX_SPACE_PROVIDER;
  mockList.mockResolvedValue([]);
  mockConnectors.mockResolvedValue([]);
  mockRefresh.mockImplementation(async (id) => ({ accessToken: `${id}-token` }));
});
afterEach(() => {
  if (original === undefined) delete process.env.TOME_WEBEX_SPACE_PROVIDER;
  else process.env.TOME_WEBEX_SPACE_PROVIDER = original;
});

it("defaults to webex and trims a configured custom connector ID", () => {
  expect(webexSpaceProvider()).toBe("webex");
  process.env.TOME_WEBEX_SPACE_PROVIDER = " custom_messaging ";
  expect(webexSpaceProvider()).toBe("custom_messaging");
});
it("selects configured personal credentials before legacy even when only legacy was forwarded", async () => {
  process.env.TOME_WEBEX_SPACE_PROVIDER = "custom_messaging";
  mockList.mockResolvedValue([
    { id: "old", provider: "webex", status: "connected" },
    { id: "new", provider: "custom_messaging", status: "connected" },
  ]);
  expect(await personalWebexSpaceToken("user-a", true, { webex: { access_token: "old-forwarded" } }))
    .toEqual({ provider: "custom_messaging", accessToken: "new-token" });
  expect(mockList).toHaveBeenCalledWith({ type: "user", id: "user-a" });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});
it("reuses a forwarded token for the selected connection only", async () => {
  process.env.TOME_WEBEX_SPACE_PROVIDER = "custom_messaging";
  mockList.mockResolvedValue([{ id: "new", provider: "custom_messaging", status: "connected" }]);
  expect(await personalWebexSpaceToken("user-a", true, { custom_messaging: { access_token: "forwarded" } }))
    .toEqual({ provider: "custom_messaging", accessToken: "forwarded" });
  expect(mockRefresh).not.toHaveBeenCalled();
});
it("falls back only to the same user's connected webex account", async () => {
  process.env.TOME_WEBEX_SPACE_PROVIDER = "custom_messaging";
  mockList.mockResolvedValue([{ id: "old", provider: "webex", status: "connected" }]);
  expect(await personalWebexSpaceToken("user-b", true)).toEqual({ provider: "webex", accessToken: "old-token" });
  expect(await personalWebexSpaceToken("user-b", false)).toBeUndefined();
});
it("does not hide preferred-provider refresh failures by using another identity", async () => {
  process.env.TOME_WEBEX_SPACE_PROVIDER = "custom_messaging";
  mockList.mockResolvedValue([
    { id: "old", provider: "webex", status: "connected" },
    { id: "new", provider: "custom_messaging", status: "connected" },
  ]);
  mockRefresh.mockRejectedValue(new Error("refresh failed"));
  await expect(personalWebexSpaceToken("user-a", true)).rejects.toThrow("refresh failed");
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(mockRefresh).toHaveBeenCalledWith("new");
});
it("uses the connector's exact display name, falling back to its ID rather than inventing a name", async () => {
  process.env.TOME_WEBEX_SPACE_PROVIDER = "custom_messaging";
  mockConnectors.mockResolvedValue([{ provider: "custom_messaging", name: "Example Spaces" }]);
  expect(await webexSpaceConnectionLabel()).toEqual({ provider: "custom_messaging", name: "Example Spaces" });
  mockConnectors.mockRejectedValue(new Error("unavailable"));
  expect(await webexSpaceConnectionLabel()).toEqual({ provider: "custom_messaging", name: "custom_messaging" });
});
