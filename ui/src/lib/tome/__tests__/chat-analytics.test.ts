jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn() }));
import { summarizeChatActivity } from "../chat-analytics";

it("deduplicates people across entity types and counts activity only in the matching window", () => {
  const now = new Date("2026-09-15T12:00:00Z");
  const result = summarizeChatActivity(
    [
      { id: "p", slug: "primary", name: "Primary", type: "project" },
      { id: "a", slug: "area", name: "Area", type: "area" },
      { id: "b", slug: "goal", name: "Goal", type: "bhag" },
      { id: "idle", slug: "idle", name: "Idle", type: "project" },
    ],
    [
      {
        _id: { projectId: "p", userId: "person-1" },
        day: 2,
        week: 3,
        month: 5,
        lastAt: now,
      },
      {
        _id: { projectId: "a", userId: "person-1" },
        day: 1,
        week: 1,
        month: 1,
        lastAt: now,
      },
      {
        _id: { projectId: "b", userId: "person-2" },
        day: 0,
        week: 0,
        month: 1,
        lastAt: new Date("2026-09-01"),
      },
      {
        _id: { projectId: "removed", userId: "person-3" },
        day: 1,
        week: 1,
        month: 1,
        lastAt: now,
      },
      {
        _id: { projectId: "idle", userId: "" },
        day: 1,
        week: 1,
        month: 1,
        lastAt: now,
      },
    ],
    [],
    now,
  );
  expect(result.periods.day).toEqual({
    users: 1,
    prompts: 3,
    activeEntities: { project: 1, area: 1, bhag: 0 },
  });
  expect(result.periods.month).toEqual({
    users: 2,
    prompts: 7,
    activeEntities: { project: 1, area: 1, bhag: 1 },
  });
  expect(result.totals).toEqual({ project: 2, area: 1, bhag: 1 });
  expect(JSON.stringify(result)).not.toContain("person-");
  expect(
    result.entities.find((entity) => entity.id === "idle")?.lastPromptAt,
  ).toBeNull();
});
