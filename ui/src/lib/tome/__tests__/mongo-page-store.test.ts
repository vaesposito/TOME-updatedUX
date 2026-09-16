/** @jest-environment node */

const mockUpdateMany = jest.fn();

jest.mock("../mongo-collections", () => ({
  getTomePageRevisionsCollection: async () => ({
    updateMany: (...args: unknown[]) => mockUpdateMany(...args),
  }),
}));

import { MongoPageStore } from "../mongo-page-store";

describe("MongoPageStore.finalizeDraftReport", () => {
  it("promotes accepted paths and rejects all other draft paths in one update", async () => {
    const store = new MongoPageStore();
    await store.finalizeDraftReport(
      "project-example",
      "report-example",
      ["accepted.md"],
    );

    expect(mockUpdateMany).toHaveBeenCalledWith(
      {
        project_id: "project-example",
        report_id: "report-example",
        status: "draft",
      },
      [
        {
          $set: {
            status: {
              $cond: [
                { $in: ["$path", ["accepted.md"]] },
                "$$REMOVE",
                "rejected",
              ],
            },
          },
        },
      ],
    );
  });
});
