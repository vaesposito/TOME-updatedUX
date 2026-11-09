import {
  hasSources,
  readFreshness,
  readOwner,
  readStaleness,
  readUpdateMode,
} from "@/lib/tome/project-freshness";
import type { ProjectDocument } from "@/types/projects";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const daysBefore = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString();

type Shape = Parameters<typeof readFreshness>[0];

function project(over: Partial<ProjectDocument> & Record<string, unknown> = {}): Shape {
  return {
    team_name: "Platform Engineering",
    sources: {},
    ...over,
  } as Shape;
}

const WITH_A_REPO = {
  sources: { github_repos: [{ full_name: "example/example-service" }] },
} as unknown as Partial<ProjectDocument>;

describe("who keeps a project", () => {
  it("names the person assigned to it", () => {
    expect(
      readOwner(
        project({
          data_steward: { type: "user", id: "1", email: "steward@example.com", name: "Example Steward" },
        } as Partial<ProjectDocument>),
      ),
    ).toEqual({ name: "Example Steward", kind: "user" });
  });

  it("names a team holding it, and says it is a team", () => {
    expect(
      readOwner(
        project({
          data_steward: { type: "team", id: "platform", name: "Platform Engineering" },
        } as Partial<ProjectDocument>),
      ),
    ).toEqual({ name: "Platform Engineering", kind: "team" });
  });

  it("falls back to the team, since a reader still needs someone to ask", () => {
    expect(readOwner(project())).toEqual({
      name: "Platform Engineering",
      kind: "team",
    });
  });

  it("says nobody when there is nobody", () => {
    expect(readOwner(project({ team_name: "" }))).toEqual({ name: "", kind: "none" });
  });
});

describe("whether a project keeps itself up to date", () => {
  it("says a schedule in its own words", () => {
    expect(
      readUpdateMode(
        project({
          ...WITH_A_REPO,
          autoIngest: { enabled: true, cron: "0 6 * * *", credentialOwner: null },
        } as Partial<ProjectDocument>),
      ),
    ).toEqual({ kind: "scheduled", phrase: expect.stringContaining("6:00") });
  });

  it("still says scheduled when the expression cannot be put into words", () => {
    expect(
      readUpdateMode(
        project({
          autoIngest: { enabled: true, cron: "nonsense", credentialOwner: null },
        } as Partial<ProjectDocument>),
      ),
    ).toEqual({ kind: "scheduled", phrase: "On a schedule" });
  });

  it("separates sources nobody has scheduled from a wiki written by hand", () => {
    expect(readUpdateMode(project(WITH_A_REPO))).toEqual({ kind: "on-demand" });
    expect(readUpdateMode(project())).toEqual({ kind: "manual" });
  });

  it("reads a schedule switched off as not scheduled at all", () => {
    expect(
      readUpdateMode(
        project({
          ...WITH_A_REPO,
          autoIngest: { enabled: false, cron: "0 6 * * *", credentialOwner: null },
        } as Partial<ProjectDocument>),
      ),
    ).toEqual({ kind: "on-demand" });
  });

  it("sees a source whatever kind it is", () => {
    expect(hasSources(project(WITH_A_REPO))).toBe(true);
    expect(
      hasSources(project({ sources: { confluence_url: "https://example.com/wiki" } })),
    ).toBe(true);
    expect(hasSources(project())).toBe(false);
    expect(hasSources(project({ sources: undefined }))).toBe(false);
  });
});

describe("whether a wiki can be relied on today", () => {
  it("never complains about a wiki written by hand", () => {
    expect(
      readStaleness(project({ last_ingested_at: null, last_edited_at: daysBefore(400) }), NOW),
    ).toBeNull();
  });

  it("complains about sources that have never been read", () => {
    expect(readStaleness(project(WITH_A_REPO), NOW)).toEqual({
      level: "stale",
      reason: "Sources are attached but have never been read.",
    });
  });

  it("complains when a source moved after the last read, however recent", () => {
    expect(
      readStaleness(
        project({
          ...WITH_A_REPO,
          last_ingested_at: daysBefore(1),
          last_source_event_at: new Date(daysBefore(0.5)),
        } as Partial<ProjectDocument>),
        NOW,
      ),
    ).toEqual({
      level: "stale",
      reason: "A source has changed since this was last read.",
    });
  });

  it("counts a month as out of date and a week as ageing", () => {
    expect(
      readStaleness(project({ ...WITH_A_REPO, last_ingested_at: daysBefore(31) }), NOW),
    ).toEqual({ level: "stale", reason: "Sources have not been read in a month." });
    expect(
      readStaleness(project({ ...WITH_A_REPO, last_ingested_at: daysBefore(8) }), NOW),
    ).toEqual({ level: "ageing", reason: "Sources have not been read in a week." });
  });

  it("says nothing at all about a recent read", () => {
    expect(
      readStaleness(project({ ...WITH_A_REPO, last_ingested_at: daysBefore(2) }), NOW),
    ).toBeNull();
  });
});

describe("the whole reading", () => {
  it("answers all four questions from one record", () => {
    const freshness = readFreshness(
      project({
        ...WITH_A_REPO,
        data_steward: { type: "team", id: "platform", name: "Platform Engineering" },
        last_ingested_at: daysBefore(40),
        last_edited_at: daysBefore(3),
        autoIngest: { enabled: true, cron: "0 6 * * 1", credentialOwner: null },
      } as Partial<ProjectDocument>),
      NOW,
    );

    expect(freshness.owner.name).toBe("Platform Engineering");
    expect(freshness.ingested?.toISOString()).toBe(daysBefore(40));
    expect(freshness.edited?.toISOString()).toBe(daysBefore(3));
    expect(freshness.updates.kind).toBe("scheduled");
    expect(freshness.stale?.level).toBe("stale");
  });

  it("reads a date it cannot make sense of as no date", () => {
    const freshness = readFreshness(
      project({ last_ingested_at: "not a date", last_edited_at: "" }),
      NOW,
    );

    expect(freshness.ingested).toBeNull();
    expect(freshness.edited).toBeNull();
  });
});
