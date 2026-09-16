/** @jest-environment node */
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));
jest.mock("@/lib/rbac/tome-admin", () => ({ isTomeAdmin: jest.fn() }));
jest.mock("@/lib/tome/chat-analytics", () => ({
  getTomeChatAnalytics: jest.fn(),
}));
jest.mock("@/lib/tome/ingestion-budget", () => ({
  getIngestionBudget: jest.fn(),
}));
jest.mock("@/lib/tome/usage-analytics", () => ({
  getTomeUsageAnalytics: jest.fn(),
}));
jest.mock("@/lib/tome/analytics", () => ({
  getOrgTomeConsumption: jest.fn(),
  getTomeFreshness: jest.fn(),
  getTomeLeadershipKpis: jest.fn(),
  getTomeQueryLatencyP95: jest.fn(),
  getTomeUptime: jest.fn(),
}));
import { getServerSession } from "next-auth";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { getTomeChatAnalytics } from "@/lib/tome/chat-analytics";
import { getIngestionBudget } from "@/lib/tome/ingestion-budget";
import { GET } from "../route";

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(getServerSession)
    .mockResolvedValue({ user: { email: "admin@example.test" } });
  jest.mocked(isTomeAdmin).mockResolvedValue(true);
});
it("requires an authenticated admin before reading analytics", async () => {
  jest.mocked(getServerSession).mockResolvedValueOnce(null);
  expect((await GET()).status).toBe(401);
  jest.mocked(isTomeAdmin).mockResolvedValueOnce(false);
  expect((await GET()).status).toBe(403);
  expect(getTomeChatAnalytics).not.toHaveBeenCalled();
});
it("reports a failed query without inventing zero usage or losing budget data", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.mocked(getTomeChatAnalytics).mockRejectedValueOnce(new Error("timeout"));
  jest
    .mocked(getIngestionBudget)
    .mockResolvedValueOnce({ spentUsd: 12 } as never);
  const result = await (await GET()).json();
  expect(result.data).toMatchObject({
    chat: null,
    budget: { spentUsd: 12 },
    errors: { chat: expect.stringContaining("unavailable") },
  });
  log.mockRestore();
});
