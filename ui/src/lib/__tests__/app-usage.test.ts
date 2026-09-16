const mockInsertOne = jest.fn();
const mockGetCollection = jest.fn();

let mockMongoConfigured = true;

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  get isMongoDBConfigured() {
    return mockMongoConfigured;
  },
}));

import { recordAppVisit } from "@/lib/app-usage";

describe("recordAppVisit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMongoConfigured = true;
    mockInsertOne.mockResolvedValue({ insertedId: "visit-1" });
    mockGetCollection.mockResolvedValue({ insertOne: mockInsertOne });
  });

  it("records a normalized authenticated app visit", async () => {
    const occurredAt = new Date("2026-09-16T12:00:00.000Z");

    await recordAppVisit(" Visitor@Example.com ", occurredAt);

    expect(mockGetCollection).toHaveBeenCalledWith("app_usage_events");
    expect(mockInsertOne).toHaveBeenCalledWith({
      user_email: "visitor@example.com",
      occurred_at: occurredAt,
    });
  });

  it("does not write when MongoDB is unavailable", async () => {
    mockMongoConfigured = false;

    await recordAppVisit("visitor@example.com");

    expect(mockGetCollection).not.toHaveBeenCalled();
  });
});
