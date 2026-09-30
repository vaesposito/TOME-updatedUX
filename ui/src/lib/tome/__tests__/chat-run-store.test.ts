/** @jest-environment node */

import {
  CHAT_RUN_STALE_MS,
  failStaleChatRuns,
  findActiveChatRun,
  isChatRunStale,
} from "@/lib/tome/chat-run-store";
import { getTomeChatRunsCollection } from "@/lib/tome/mongo-collections";

jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeChatRunsCollection: jest.fn(),
}));

const mockGetRuns = jest.mocked(getTomeChatRunsCollection);
const updateMany = jest.fn();
const findOne = jest.fn();

const now = new Date("2026-01-01T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

beforeEach(() => {
  jest.resetAllMocks();
  updateMany.mockResolvedValue({ modifiedCount: 0 });
  findOne.mockResolvedValue(null);
  mockGetRuns.mockResolvedValue({ updateMany, findOne } as never);
});

describe("isChatRunStale", () => {
  it("flags active runs with no event inside the stale window", () => {
    const updated_at = ago(CHAT_RUN_STALE_MS + 1);
    expect(isChatRunStale({ status: "running", updated_at }, now)).toBe(true);
    expect(isChatRunStale({ status: "starting", updated_at }, now)).toBe(true);
  });

  it("keeps recently updated active runs alive", () => {
    expect(
      isChatRunStale({ status: "running", updated_at: ago(CHAT_RUN_STALE_MS - 1) }, now),
    ).toBe(false);
  });

  it("never flags terminal runs", () => {
    const updated_at = ago(CHAT_RUN_STALE_MS * 10);
    expect(isChatRunStale({ status: "completed", updated_at }, now)).toBe(false);
    expect(isChatRunStale({ status: "failed", updated_at }, now)).toBe(false);
  });
});

describe("failStaleChatRuns", () => {
  it("fails only active runs past the stale cutoff", async () => {
    updateMany.mockResolvedValue({ modifiedCount: 1 });

    await expect(failStaleChatRuns({ _id: "run-1" }, now)).resolves.toBe(1);

    const [filter, update] = updateMany.mock.calls[0];
    expect(filter).toEqual({
      _id: "run-1",
      status: { $in: ["starting", "running"] },
      updated_at: { $lt: ago(CHAT_RUN_STALE_MS) },
    });
    expect(update.$set).toMatchObject({
      status: "failed",
      updated_at: now,
      finished_at: now,
    });
    expect(update.$set.error).toEqual(expect.any(String));
  });
});

describe("findActiveChatRun", () => {
  it("fails stale runs for the user before resolving the active one", async () => {
    const active = { _id: "run-2", status: "running" };
    findOne.mockResolvedValue(active);

    await expect(findActiveChatRun("project-1", "test-user@example.com")).resolves.toBe(active);

    expect(updateMany.mock.calls[0][0]).toMatchObject({
      project_id: "project-1",
      user_id: "test-user@example.com",
    });
    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      findOne.mock.invocationCallOrder[0],
    );
    expect(findOne).toHaveBeenCalledWith(
      {
        project_id: "project-1",
        user_id: "test-user@example.com",
        status: { $in: ["starting", "running"] },
      },
      { sort: { created_at: -1 } },
    );
  });
});
