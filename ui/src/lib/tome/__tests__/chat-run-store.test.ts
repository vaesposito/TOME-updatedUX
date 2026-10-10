/** @jest-environment node */

import {
  CHAT_RUN_HEARTBEAT_MS,
  CHAT_RUN_ORPHAN_MS,
  failOrphanedChatRuns,
  findActiveChatRun,
  finishChatRun,
  heartbeatChatRun,
  isChatRunOrphaned,
  stopChatRun,
  STOPPED_RUN_ERROR,
  watchChatRun,
} from "@/lib/tome/chat-run-store";
import { getTomeChatRunsCollection } from "@/lib/tome/mongo-collections";

jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeChatRunsCollection: jest.fn(),
}));

const mockGetRuns = jest.mocked(getTomeChatRunsCollection);
const updateOne = jest.fn();
const updateMany = jest.fn();
const findOne = jest.fn();

const now = new Date("2026-01-01T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const ACTIVE = { $in: ["starting", "running"] };

beforeEach(() => {
  jest.resetAllMocks();
  updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  updateMany.mockResolvedValue({ modifiedCount: 0 });
  findOne.mockResolvedValue(null);
  mockGetRuns.mockResolvedValue({ updateOne, updateMany, findOne } as never);
});

describe("isChatRunOrphaned", () => {
  it("flags active runs whose owner stopped heartbeating", () => {
    const heartbeat_at = ago(CHAT_RUN_ORPHAN_MS + 1);
    expect(isChatRunOrphaned({ status: "running", updated_at: now, heartbeat_at }, now)).toBe(true);
    expect(isChatRunOrphaned({ status: "starting", updated_at: now, heartbeat_at }, now)).toBe(true);
  });

  it("keeps a silent run alive while its owner heartbeats", () => {
    expect(
      isChatRunOrphaned(
        { status: "running", updated_at: ago(60 * 60 * 1000), heartbeat_at: ago(1_000) },
        now,
      ),
    ).toBe(false);
  });

  it("falls back to updated_at for runs without a heartbeat", () => {
    expect(
      isChatRunOrphaned({ status: "running", updated_at: ago(CHAT_RUN_ORPHAN_MS + 1) }, now),
    ).toBe(true);
  });

  it("never flags terminal runs", () => {
    const old = ago(CHAT_RUN_ORPHAN_MS * 10);
    expect(isChatRunOrphaned({ status: "completed", updated_at: old, heartbeat_at: old }, now)).toBe(false);
    expect(isChatRunOrphaned({ status: "failed", updated_at: old, heartbeat_at: old }, now)).toBe(false);
  });
});

describe("failOrphanedChatRuns", () => {
  it("fails only active runs past the heartbeat cutoff", async () => {
    updateMany.mockResolvedValue({ modifiedCount: 1 });

    await expect(failOrphanedChatRuns({ _id: "run-1" }, now)).resolves.toBe(1);

    const [filter, update] = updateMany.mock.calls[0];
    const cutoff = ago(CHAT_RUN_ORPHAN_MS);
    expect(filter).toEqual({
      _id: "run-1",
      status: ACTIVE,
      $or: [
        { heartbeat_at: { $lt: cutoff } },
        { heartbeat_at: { $exists: false }, updated_at: { $lt: cutoff } },
      ],
    });
    expect(update.$set).toMatchObject({ status: "failed", updated_at: now, finished_at: now });
  });
});

describe("heartbeatChatRun", () => {
  it("renews only an active run and reports whether it still is", async () => {
    await expect(heartbeatChatRun("run-1")).resolves.toBe(true);
    expect(updateOne.mock.calls[0][0]).toEqual({ _id: "run-1", status: ACTIVE });
    expect(updateOne.mock.calls[0][1].$set.heartbeat_at).toEqual(expect.any(Date));

    updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    await expect(heartbeatChatRun("run-1")).resolves.toBe(false);
  });
});

describe("watchChatRun", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("heartbeats until the run is found stopped, then fires once", async () => {
    const onInactive = jest.fn();
    watchChatRun("run-1", onInactive);

    await jest.advanceTimersByTimeAsync(CHAT_RUN_HEARTBEAT_MS);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(onInactive).not.toHaveBeenCalled();

    updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    await jest.advanceTimersByTimeAsync(CHAT_RUN_HEARTBEAT_MS * 3);
    expect(onInactive).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledTimes(2);
  });

  it("treats a failed heartbeat write as transient", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const onInactive = jest.fn();
    updateOne.mockRejectedValueOnce(new Error("mongo unavailable"));
    watchChatRun("run-1", onInactive);

    await jest.advanceTimersByTimeAsync(CHAT_RUN_HEARTBEAT_MS * 2);
    expect(onInactive).not.toHaveBeenCalled();
    expect(updateOne).toHaveBeenCalledTimes(2);
  });

  it("stops heartbeating once released", async () => {
    const unwatch = watchChatRun("run-1", jest.fn());
    unwatch();
    await jest.advanceTimersByTimeAsync(CHAT_RUN_HEARTBEAT_MS * 3);
    expect(updateOne).not.toHaveBeenCalled();
  });
});

describe("stopChatRun", () => {
  it("fails the caller's own active run", async () => {
    await expect(stopChatRun("run-1", "project-1", "test-user@example.com")).resolves.toBe(true);
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toEqual({
      _id: "run-1",
      project_id: "project-1",
      user_id: "test-user@example.com",
      status: ACTIVE,
    });
    expect(update.$set).toMatchObject({ status: "failed", error: STOPPED_RUN_ERROR });
  });

  it("reports runs that were no longer active", async () => {
    updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    await expect(stopChatRun("run-1", "project-1", "test-user@example.com")).resolves.toBe(false);
  });
});

describe("finishChatRun", () => {
  it("cannot reopen a stopped or orphaned run", async () => {
    await finishChatRun("run-1", "completed");
    expect(updateOne.mock.calls[0][0]).toEqual({ _id: "run-1", status: ACTIVE });
  });
});

describe("findActiveChatRun", () => {
  it("fails orphaned runs for the user before resolving the active one", async () => {
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
      { project_id: "project-1", user_id: "test-user@example.com", status: ACTIVE },
      { sort: { created_at: -1 } },
    );
  });
});
