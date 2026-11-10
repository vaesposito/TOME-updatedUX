import {
  canonicalLabel,
  canonicalPlacement,
  createRequestFrom,
  emptyDraft,
  invitationsToSend,
  kindsFor,
  stewardChoices,
  stewardFor,
  type FunctionOption,
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

  it("files a subject under a function nobody has used yet", () => {
    // The vocabulary is widened by the subjects themselves, so a name that
    // exists nowhere else arrives as a group once this subject carries it.
    const body = createRequestFrom(
      draft({
        kind: "subject",
        placement: { function: "Example Function", category: "Example Category" },
      }),
    );

    expect(body.functions).toEqual(["Example Function"]);
    expect(body.categories).toEqual(["Example Category"]);
  });

  it("places a project under both its BHAG and its area", () => {
    // Both named on the project itself: an area is not guaranteed to name
    // its own parent, so inferring the BHAG through it can lose it.
    const body = createRequestFrom(
      draft({
        kind: "project",
        placement: { initiative: "example-bhag", area: "example-area" },
      }),
    );

    expect(body.initiatives).toEqual(["example-bhag"]);
    expect(body.areas).toEqual(["example-area"]);
    expect(body).not.toHaveProperty("functions");
  });

  it("places an area under its BHAG, and gives it no area of its own", () => {
    const body = createRequestFrom(
      draft({
        kind: "area",
        placement: { initiative: "example-bhag", area: "example-area" },
      }),
    );

    expect(body.initiatives).toEqual(["example-bhag"]);
    expect(body).not.toHaveProperty("areas");
  });

  it("gives a BHAG no parent, because it has none", () => {
    const body = createRequestFrom(
      draft({ kind: "bhag", placement: { initiative: "example-bhag" } }),
    );

    expect(body).not.toHaveProperty("initiatives");
    expect(body).not.toHaveProperty("areas");
  });

  it("leaves an unplaced project unplaced rather than guessing", () => {
    const body = createRequestFrom(draft({ kind: "project" }));

    expect(body).not.toHaveProperty("initiatives");
    expect(body).not.toHaveProperty("areas");
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

  it("offers the owning team and everyone invited by name", () => {
    // Only parties the step knows: a group invitation is not a steward, and
    // an address still being typed is not a person yet.
    const invitations = [
      { id: "1", kind: "group" as const, subject: "other-team", role: "member" as const },
      { id: "2", kind: "user" as const, subject: "first@example.com", role: "member" as const },
      { id: "3", kind: "user" as const, subject: "  ", role: "admin" as const },
    ];

    expect(stewardChoices(draft({ invitations }))).toEqual([
      "team:example-team",
      "user:first@example.com",
    ]);
  });

  it("stewards to the reader's own pick over the first admin", () => {
    const invitations = [
      { id: "1", kind: "user" as const, subject: "admin@example.com", role: "admin" as const },
    ];

    expect(stewardFor(draft({ invitations, steward: "team:example-team" }))).toEqual({
      type: "team",
      team_id: "example-team",
    });
  });

  it("drops a pick whose person is no longer on the step", () => {
    // An address that was edited after it was picked names nobody now, so the
    // default stands rather than the space being handed to a stale one.
    expect(stewardFor(draft({ steward: "user:gone@example.com" }))).toEqual({
      type: "team",
      team_id: "example-team",
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

describe("naming a function or category that does not exist yet", () => {
  const vocabulary: FunctionOption[] = [
    { name: "Example Function", categories: ["Example Category"] },
    { name: "Other Function", categories: [] },
  ];

  it("takes the spelling already in use when only case or spacing differs", () => {
    expect(canonicalLabel("example  function", ["Example Function"])).toBe("Example Function");
    expect(canonicalLabel("  EXAMPLE FUNCTION ", ["Example Function"])).toBe("Example Function");
  });

  it("reports a genuinely new name as new", () => {
    expect(canonicalLabel("Third Function", ["Example Function"])).toBeNull();
    expect(canonicalLabel("   ", ["Example Function"])).toBeNull();
  });

  it("settles a typed function and category onto the existing spellings", () => {
    const settled = canonicalPlacement(
      draft({
        kind: "subject",
        placement: { function: "example function", category: "example category" },
      }),
      vocabulary,
    );

    expect(settled.placement).toMatchObject({
      function: "Example Function",
      category: "Example Category",
    });
  });

  it("keeps a new name exactly as it was written", () => {
    const settled = canonicalPlacement(
      draft({
        kind: "subject",
        placement: { function: "Third Function", category: "Fresh Category" },
      }),
      vocabulary,
    );

    expect(settled.placement).toMatchObject({
      function: "Third Function",
      category: "Fresh Category",
    });
  });

  it("does not match a category against a function that does not own it", () => {
    // "Example Category" belongs to Example Function; under Other Function
    // the same words are a new category, not that one.
    const settled = canonicalPlacement(
      draft({
        kind: "subject",
        placement: { function: "Other Function", category: "example category" },
      }),
      vocabulary,
    );

    expect(settled.placement?.category).toBe("example category");
  });

  it("leaves the hierarchy axis alone", () => {
    const original = draft({
      kind: "project",
      placement: { initiative: "example-bhag", area: "example-area" },
    });

    expect(canonicalPlacement(original, vocabulary)).toBe(original);
  });
});
