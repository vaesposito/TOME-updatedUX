/** @jest-environment node */
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));
jest.mock("@/lib/rbac/tome-admin", () => ({ isTomeAdmin: jest.fn() }));
jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn() }));
jest.mock("@/lib/tome/audit", () => ({
  auditTome: jest.fn(),
  tomeActorFromAuth: () => ({ type: "user", id: "admin" }),
}));
jest.mock("@/lib/tome/ingestion-budget", () => ({
  ...jest.requireActual("@/lib/tome/ingestion-budget"),
  saveIngestionBudget: jest.fn(),
  getIngestionBudget: jest.fn(),
}));
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import {
  saveIngestionBudget,
  getIngestionBudget,
} from "@/lib/tome/ingestion-budget";
import { auditTome } from "@/lib/tome/audit";
import { PATCH } from "../route";
const request = (value: unknown) =>
  new NextRequest("http://example.test/api/tome/admin/analytics/budget", {
    method: "PATCH",
    body: JSON.stringify(value),
  });
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(getServerSession)
    .mockResolvedValue({ user: { email: "admin@example.test" } });
  jest.mocked(isTomeAdmin).mockResolvedValue(true);
});
it("denies unauthenticated and non-admin writes before persistence", async () => {
  jest.mocked(getServerSession).mockResolvedValueOnce(null);
  expect((await PATCH(request({}))).status).toBe(401);
  jest.mocked(isTomeAdmin).mockResolvedValueOnce(false);
  expect(
    (await PATCH(request({ monthlyLimitUsd: 100, alertAtPercent: 80 }))).status,
  ).toBe(403);
  expect(saveIngestionBudget).not.toHaveBeenCalled();
});
it("validates input and audits a successful admin change", async () => {
  expect(
    (await PATCH(request({ monthlyLimitUsd: -1, alertAtPercent: 80 }))).status,
  ).toBe(400);
  expect(saveIngestionBudget).not.toHaveBeenCalled();
  jest
    .mocked(getIngestionBudget)
    .mockResolvedValue({ monthlyLimitUsd: 100, alertAtPercent: 80 } as never);
  expect(
    (await PATCH(request({ monthlyLimitUsd: 100, alertAtPercent: 80 }))).status,
  ).toBe(200);
  expect(saveIngestionBudget).toHaveBeenCalledWith(
    { monthlyLimitUsd: 100, alertAtPercent: 80 },
    "admin@example.test",
  );
  expect(auditTome).toHaveBeenCalledWith(
    expect.objectContaining({ action: "tome.analytics.budget.update" }),
  );
});
it("reports persistence failures and does not claim success", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest
    .mocked(saveIngestionBudget)
    .mockRejectedValueOnce(new Error("database unavailable"));
  expect(
    (await PATCH(request({ monthlyLimitUsd: null, alertAtPercent: 80 })))
      .status,
  ).toBe(503);
  expect(auditTome).not.toHaveBeenCalled();
  log.mockRestore();
});
