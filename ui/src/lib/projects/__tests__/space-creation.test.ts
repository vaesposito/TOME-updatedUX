import {
  createRequestFrom,
  emptyDraft,
  invitationsToSend,
  kindsFor,
  stewardFor,
  type SpaceDraft,
} from "@/lib/projects/space-creation";

const REPO = {
  id: "repo",
  kind: "github" as const,
  value: "example-org/example-repo",
};

/** A draft as the first step leaves it, with nothing attached and nobody asked. */
function draft(patch: Partial<SpaceDraft> = {}): SpaceDraft {
  return {
    ...emptyDraft(patch.placement),
    name: "Example Space",
    description: "What it covers.",
    teamSlug: "example-team",
    ...patch,
  };
}

describe("which kinds a flow can make", () => {
  it("offers the three hierarchy kinds when opened from the catalogue", () => {
    expect(kindsFor(undefined)).toEqual(["project", "area", "bhag"]);
  });

  it("offers only a subject when opened on the function axis", () => {
    // A BHAG inside a category would be a record on both axes at once,
    // which is the thing the two tabs exist to keep apart.
    expect(kindsFor({ function: "Example Function" })).toEqual(["subject"]);
    expect(
      kindsFor({ function: "Example Function", category: "Example Category" }),
    ).toEqual(["subject"]);
  });
});

describe("what the three steps ask the endpoint for", () => {
  it("makes a subject that carries its own function and category", () => {
    const body = createRequestFrom(
      draft({
        placement: { function: "Example Function", category: "Example Category" },
        kind: "subject",
      }),
    );

    expect(body.functions).toEqual(["Example Function"]);
    expect(body.categories).toEqual(["Example Category"]);
    // One kind of leaf space: which axis it is on is said by the labels.
    expect(body.type).toBe("project");
  });

  it("leaves the category off a subject made directly in a function", () => {
    const body = createRequestFrom(
      draft({ placement: { function: "Example Function" }, kind: "subject" }),
    );

    expect(body.functions).toEqual(["Example Function"]);
    expect(body).not.toHaveProperty("categories");
  });

  it("names no function on a space made from the catalogue", () => {
    const body = createRequestFrom(draft({ kind: "bhag" }));

    expect(body.type).toBe("bhag");
    expect(body).not.toHaveProperty("functions");
  });

  it("schedules weekly by default once something is attached", () => {
    const body = createRequestFrom(draft({ sources: [REPO] }));

    expect(body.auto_ingest).toEqual({
      enabled: true,
      // A weekday rather than every day: the weekly preset compiled to UTC.
      cron: expect.stringMatching(/^\d{1,2} \d{1,2} \* \* \d$/),
    });
  });

  it("schedules daily when the reader changes the preset", () => {
    const base = draft({ sources: [REPO] });
    const body = createRequestFrom({
      ...base,
      schedule: { ...base.schedule, preset: "daily" },
    });

    expect(body.auto_ingest).toEqual({
      enabled: true,
      cron: expect.stringMatching(/^\d{1,2} \d{1,2} \* \* \*$/),
    });
  });

  it("asks for no schedule at all when the sources step was skipped", () => {
    // Skipping leaves nothing attached and the schedule switched off, which
    // is a space that was never given one — not one given a disabled one.
    const body = createRequestFrom(draft({ scheduleEnabled: false }));

    expect(body).not.toHaveProperty("auto_ingest");
    expect(body.github_repos).toEqual([]);
  });

  it("sends the repositories, and keeps the rest in the dialog", () => {
    // Everything but a repository is stored as an object the real pickers
    // build from a live account, so a typed name cannot stand in for one.
    const body = createRequestFrom(
      draft({
        sources: [
          REPO,
          { id: "c", kind: "confluence", value: "Example Confluence Space" },
        ],
      }),
    );

    expect(body.github_repos).toEqual(["example-org/example-repo"]);
    expect(JSON.stringify(body)).not.toContain("Example Confluence Space");
  });

  it("asks for no schedule when one is wanted but nothing was attached", () => {
    expect(createRequestFrom(draft({ scheduleEnabled: true }))).not.toHaveProperty(
      "auto_ingest",
    );
  });
});

describe("who ends up running the space", () => {
  it("stewards to the owning team when nobody was named an admin", () => {
    expect(stewardFor(draft())).toEqual({
      type: "team",
      team_id: "example-team",
    });
  });

  it("stewards to the first person invited as an admin", () => {
    const invitations = [
      { id: "1", kind: "user" as const, subject: "first@example.com", role: "member" as const },
      { id: "2", kind: "user" as const, subject: "second@example.com", role: "admin" as const },
      { id: "3", kind: "user" as const, subject: "third@example.com", role: "admin" as const },
    ];

    expect(stewardFor(draft({ invitations }))).toEqual({
      type: "user",
      email: "second@example.com",
    });
  });

  it("does not invite the steward or the owning team a second time", () => {
    const invitations = [
      { id: "1", kind: "group" as const, subject: "example-team", role: "member" as const },
      { id: "2", kind: "group" as const, subject: "other-team", role: "member" as const },
      { id: "3", kind: "user" as const, subject: "steward@example.com", role: "admin" as const },
      { id: "4", kind: "user" as const, subject: "reader@example.com", role: "member" as const },
      { id: "5", kind: "user" as const, subject: "  ", role: "member" as const },
    ];

    expect(invitationsToSend(draft({ invitations })).map((i) => i.subject)).toEqual([
      "other-team",
      "reader@example.com",
    ]);
  });
});
