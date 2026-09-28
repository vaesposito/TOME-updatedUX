/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockRequireTomeEditor = jest.fn();
const mockGetCollection = jest.fn();
const mockDiscoverMeetingSeries = jest.fn();
const mockInteractiveWebexMeetingInvoker = jest.fn();
const mockRequestWebexMeetingOwnerCheck = jest.fn();
const mockAuditTome = jest.fn();
const mockMeetingSeriesHostEligibility = jest.fn();
const mockNonHostMeetingSeriesAllowed = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
  requireTomeEditor: (...args: unknown[]) => mockRequireTomeEditor(...args),
}));

jest.mock("@/lib/tome/agent-proxy", () => ({
  sessionSub: jest.fn(() => "owner-subject"),
}));

jest.mock("@/lib/tome/audit", () => ({
  auditTome: (...args: unknown[]) => mockAuditTome(...args),
  tomeActorFromAuth: jest.fn(() => ({
    type: "user",
    id: "owner-subject",
    email: "owner@example.test",
  })),
}));

jest.mock("@/lib/tome/auto-ingest/cursor", () => ({
  requestWebexMeetingOwnerCheck: (...args: unknown[]) =>
    mockRequestWebexMeetingOwnerCheck(...args),
}));

jest.mock("@/lib/tome/webex-meeting-history", () => ({
  loadWebexMeetingOccurrenceHistory: jest.fn(async () => []),
}));

jest.mock("@/lib/tome/webex-meeting-series", () => ({
  createWebexMeetingSeriesSubscription: jest.fn(
    ({ candidate, credentialOwner, now }: {
      candidate: { seriesKey: string; title: string; siteUrl?: string };
      credentialOwner: { subject: string; email: string; name: string; confirmedAt: string };
      now: Date;
    }) => ({
      id: "subscription-id",
      enabled: true,
      seriesKey: candidate.seriesKey,
      seriesSlug: "example-weekly",
      title: candidate.title,
      siteUrl: candidate.siteUrl,
      sourceRefs: {},
      credentialOwner,
      createdAt: now.toISOString(),
      lastStatus: "pending",
    }),
  ),
  discoverMeetingSeries: (...args: unknown[]) => mockDiscoverMeetingSeries(...args),
  interactiveWebexMeetingInvoker: (...args: unknown[]) =>
    mockInteractiveWebexMeetingInvoker(...args),
  meetingSeriesHostEligibility: (...args: unknown[]) =>
    mockMeetingSeriesHostEligibility(...args),
  ...jest.requireActual("@/lib/tome/webex-meeting-series-identity"),
  nonHostMeetingSeriesAllowed: () => mockNonHostMeetingSeriesAllowed(),
  webexMeetingSeriesDiscoveryWindow: jest.fn(() => ({
    from: new Date("2026-09-01T00:00:00Z"),
    to: new Date("2026-12-01T00:00:00Z"),
    now: new Date("2026-09-03T00:00:00Z"),
  })),
}));

import { GET, POST } from "../route";

const context = { params: Promise.resolve({ slug: "example-project" }) };
const updateOne = jest.fn();

describe("/api/tome/projects/[slug]/webex-meeting-series", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateOne.mockResolvedValue({ modifiedCount: 1 });
    mockGetCollection.mockResolvedValue({ updateOne });
    mockRequestWebexMeetingOwnerCheck.mockResolvedValue(undefined);
    mockMeetingSeriesHostEligibility.mockReturnValue({ canAutoIngest: true });
    mockNonHostMeetingSeriesAllowed.mockReturnValue(true);
    mockInteractiveWebexMeetingInvoker.mockResolvedValue(jest.fn());
    mockDiscoverMeetingSeries.mockResolvedValue([
      {
        seriesKey: "example-series",
        title: "Example weekly",
        siteUrl: "https://example.webex.test/",
      },
    ]);
    mockLoadTomeProject.mockResolvedValue({
      projectId: "project-id",
      project: {
        _id: "project-id",
        type: "project",
        slug: "example-project",
        autoIngest: {
          enabled: false,
          cron: "0 9 * * *",
          credentialOwner: null,
          webexMeetingSeries: [],
        },
      },
      canEdit: true,
      user: { email: "owner@example.test" },
      session: {
        sub: "owner-subject",
        user: { name: "Example Owner", email: "owner@example.test" },
      },
    });
  });

  it("requests an immediate owner/site refresh after persisting a new subscription", async () => {
    const response = await POST(
      new NextRequest(
        "http://example.test/api/tome/projects/example-project/webex-meeting-series",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seriesKey: "example-series" }),
        },
      ),
      context,
    );

    expect(response.status).toBe(201);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(mockRequestWebexMeetingOwnerCheck).toHaveBeenCalledWith(
      "owner-subject",
      "https://example.webex.test",
      expect.any(Date),
    );
    expect(updateOne.mock.invocationCallOrder[0]).toBeLessThan(
      mockRequestWebexMeetingOwnerCheck.mock.invocationCallOrder[0],
    );
  });

  it("allows an Area to subscribe to a recurring meeting", async () => {
    mockLoadTomeProject.mockResolvedValueOnce({
      projectId: "area-id",
      project: {
        _id: "area-id",
        type: "area",
        slug: "example-area",
        autoIngest: {
          enabled: false,
          cron: "0 9 * * *",
          credentialOwner: null,
          webexMeetingSeries: [],
        },
      },
      canEdit: true,
      user: { email: "owner@example.test" },
      session: {
        sub: "owner-subject",
        user: { name: "Example Owner", email: "owner@example.test" },
      },
    });

    const response = await POST(
      new NextRequest(
        "http://example.test/api/tome/projects/example-area/webex-meeting-series",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seriesKey: "example-series" }),
        },
      ),
      context,
    );

    expect(response.status).toBe(201);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "area-id" },
      expect.objectContaining({
        $set: expect.objectContaining({
          autoIngest: expect.objectContaining({
            webexMeetingSeries: [expect.objectContaining({ id: "subscription-id" })],
          }),
        }),
      }),
    );
  });

  it("allows a BHAG to subscribe to a recurring meeting", async () => {
    mockLoadTomeProject.mockResolvedValueOnce({
      projectId: "bhag-id",
      project: {
        _id: "bhag-id",
        type: "bhag",
        slug: "example-bhag",
        autoIngest: {
          enabled: false,
          cron: "0 9 * * *",
          credentialOwner: null,
          webexMeetingSeries: [],
        },
      },
      canEdit: true,
      user: { email: "owner@example.test" },
      session: {
        sub: "owner-subject",
        user: { name: "Example Owner", email: "owner@example.test" },
      },
    });

    const response = await POST(
      new NextRequest(
        "http://example.test/api/tome/projects/example-bhag/webex-meeting-series",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seriesKey: "example-series" }),
        },
      ),
      context,
    );
    expect(response.status).toBe(201);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "bhag-id" },
      expect.objectContaining({
        $set: expect.objectContaining({
          autoIngest: expect.objectContaining({
            webexMeetingSeries: [expect.objectContaining({ id: "subscription-id" })],
          }),
        }),
      }),
    );
  });

  it("rejects adding a non-hosted series when the policy is disabled", async () => {
    mockMeetingSeriesHostEligibility.mockReturnValue({ canAutoIngest: false });
    mockNonHostMeetingSeriesAllowed.mockReturnValue(false);

    const response = await POST(
      new NextRequest(
        "http://example.test/api/tome/projects/example-project/webex-meeting-series",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seriesKey: "example-series" }),
        },
      ),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("WEBEX_NON_HOST_MEETING_SERIES_DISABLED");
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("refreshes the saved title from an exact series, not a different calendar meeting sharing j.php", async () => {
    const tctx = await mockLoadTomeProject();
    tctx.project.autoIngest.webexMeetingSeries = [{
      id: "saved-series",
      seriesKey: "webex:original",
      title: "Original title",
      credentialOwner: { subject: "owner-subject" },
      sourceRefs: { meetingSeriesId: "original", webLink: "https://meetings.example.test/j.php?MTID=original" },
    }];
    mockDiscoverMeetingSeries.mockResolvedValueOnce([
      {
        seriesKey: "userhub:other", title: "Completely different title",
        sourceRefs: { userHubSeriesId: "other", webLink: "https://meetings.example.test/j.php?MTID=other" },
      },
      { ...tctx.project.autoIngest.webexMeetingSeries[0], title: "Original title renamed by host" },
    ]);
    const response = await GET(new NextRequest(
      "http://example.test/api/tome/projects/example-project/webex-meeting-series?discover=1",
    ), context);
    expect(response.status).toBe(200);
    expect((await response.json()).data.subscriptions[0].title).toBe("Original title renamed by host");
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("does not treat a different meeting using j.php as an already-added subscription", async () => {
    const tctx = await mockLoadTomeProject();
    tctx.project.autoIngest.webexMeetingSeries = [{
      id: "saved-series", seriesKey: "webex:original", title: "Original title",
      credentialOwner: { subject: "owner-subject" },
      sourceRefs: { meetingSeriesId: "original", webLink: "https://meetings.example.test/j.php?MTID=original" },
    }];
    mockDiscoverMeetingSeries.mockResolvedValueOnce([{
      seriesKey: "userhub:new", title: "New title",
      sourceRefs: { userHubSeriesId: "new", webLink: "https://meetings.example.test/j.php?MTID=new" },
    }]);
    const response = await POST(new NextRequest(
      "http://example.test/api/tome/projects/example-project/webex-meeting-series", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesKey: "userhub:new" }),
      },
    ), context);
    expect(response.status).toBe(201);
    expect(tctx.project.autoIngest.webexMeetingSeries).toHaveLength(2);
  });

  it("refuses an ambiguous duplicate instead of selecting the first saved subscription", async () => {
    const tctx = await mockLoadTomeProject();
    const metadata = { title: "Weekly review", hostEmail: "host@example.test" };
    const webLink = "https://meetings.example.test/meet/shared-room";
    tctx.project.autoIngest.webexMeetingSeries = ["first", "second"].map((id) => ({
      ...metadata, id, seriesKey: `webex:${id}`,
      credentialOwner: { subject: "owner-subject" },
      sourceRefs: { meetingSeriesId: id, webLink },
    }));
    mockDiscoverMeetingSeries.mockResolvedValueOnce([{
      ...metadata, seriesKey: "userhub:new", sourceRefs: { userHubSeriesId: "new", webLink },
    }]);
    const response = await POST(new NextRequest(
      "http://example.test/api/tome/projects/example-project/webex-meeting-series", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesKey: "userhub:new" }),
      },
    ), context);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("WEBEX_MEETING_SERIES_AMBIGUOUS");
    expect(updateOne).not.toHaveBeenCalled();
    expect(mockRequestWebexMeetingOwnerCheck).not.toHaveBeenCalled();
  });
});
