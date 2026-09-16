jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn() }));
import { getCollection } from "@/lib/mongodb";
import {
  getIngestionBudget,
  summarizeIngestionBudget,
  validateBudgetSettings,
  type BudgetRunRow,
} from "../ingestion-budget";

const rows: BudgetRunRow[] = [
  {
    _id: { projectId: "p", synthesis: false },
    runs: 3,
    measuredRuns: 2,
    costUsd: 75,
    inputTokens: 100,
    outputTokens: 20,
    pendingRuns: 1,
  },
  {
    _id: { projectId: "a", synthesis: true },
    runs: 1,
    measuredRuns: 1,
    costUsd: 10,
    inputTokens: 10,
    outputTokens: 2,
    pendingRuns: 0,
  },
];
const now = new Date("2026-09-15T12:00:00Z");
it("includes synthesis and removed entities, discloses unknown cost, and warns at the threshold", () => {
  const result = summarizeIngestionBudget(
    { monthlyLimitUsd: 100, alertAtPercent: 80 },
    rows,
    [],
    now,
  );
  expect(result).toMatchObject({
    spentUsd: 85,
    remainingUsd: 15,
    utilizationPercent: 85,
    status: "near_limit",
    unmeasuredRuns: 1,
    pendingRuns: 1,
  });
  expect(result.byEntity[0]).toMatchObject({
    slug: null,
    name: "Removed entity",
    ingestionUsd: 75,
  });
  expect(result.byEntity[1].synthesisUsd).toBe(10);
});
it("distinguishes an unset limit, a zero-cost month, and an exhausted budget", () => {
  expect(
    summarizeIngestionBudget(
      { monthlyLimitUsd: null, alertAtPercent: 80 },
      [],
      [],
      now,
    ),
  ).toMatchObject({
    spentUsd: 0,
    remainingUsd: null,
    status: "not_configured",
  });
  expect(
    summarizeIngestionBudget(
      { monthlyLimitUsd: 50, alertAtPercent: 80 },
      rows,
      [],
      now,
    ),
  ).toMatchObject({ remainingUsd: 0, status: "over_budget" });
});
it.each([0, -1, Infinity, NaN, "100", undefined, 1.001])(
  "rejects invalid monthly limit %s",
  (monthlyLimitUsd) => {
    expect(() =>
      validateBudgetSettings({ monthlyLimitUsd, alertAtPercent: 80 }),
    ).toThrow();
  },
);
it("allows removal and rejects invalid warning thresholds", () => {
  expect(
    validateBudgetSettings({ monthlyLimitUsd: null, alertAtPercent: 80 })
      .monthlyLimitUsd,
  ).toBeNull();
  expect(() =>
    validateBudgetSettings({ monthlyLimitUsd: 10, alertAtPercent: 0 }),
  ).toThrow();
  expect(() =>
    validateBudgetSettings({ monthlyLimitUsd: 10, alertAtPercent: 80.1 }),
  ).toThrow();
});
it("queries the UTC calendar month by run start and does not exclude archived entities", async () => {
  const aggregate = jest.fn().mockReturnValue({ toArray: async () => [] });
  const find = jest.fn().mockReturnValue({ toArray: async () => [] });
  jest.mocked(getCollection).mockImplementation(
    async () =>
      ({
        findOne: async () => null,
        aggregate,
        find,
      }) as never,
  );
  const result = await getIngestionBudget(new Date("2026-01-01T00:15:00Z"));
  expect(aggregate.mock.calls[0][0][0]).toEqual({
    $match: {
      started_at: {
        $gte: new Date("2026-01-01T00:00:00Z"),
        $lte: new Date("2026-01-01T00:15:00Z"),
      },
    },
  });
  expect(find).toHaveBeenCalledWith({}, expect.anything());
  expect(result.periodEnd).toBe("2026-02-01T00:00:00.000Z");
});
