import {
  notifyPageSaved,
  parsePageNotifySelection,
} from "@/lib/tome/page-notifications";
import { createInAppNotification } from "@/lib/in-app-notifications.server";
import { listPageWatcherSubjects } from "@/lib/tome/watchers";
import { PAGE_NOTIFY_NOTE_MAX } from "@/types/tome";

jest.mock("@/lib/in-app-notifications.server",() => ({
  createInAppNotification: jest.fn(async () => undefined),
}));
jest.mock("@/lib/tome/watchers",() => ({
  listPageWatcherSubjects: jest.fn(async () => ["watcher-subject"]),
}));
// Stands in for the `users` collection, so a test can decide which tagged
// emails resolve to a CAIPE identity and which cannot be reached.
let mockDirectory: Array<{ email: string; keycloak_sub?: string }> = [];
jest.mock("@/lib/mongodb",() => ({
  getCollection: jest.fn(async () => ({
    find: () => ({ project: () => ({ toArray: async () => mockDirectory }) }),
  })),
}));

const created = createInAppNotification as jest.MockedFunction<
  typeof createInAppNotification
>;
const watchers = listPageWatcherSubjects as jest.MockedFunction<
  typeof listPageWatcherSubjects
>;

const SAVE = {
  entitySlug: "skills-catalog",
  entityTitle: "Skills Catalog",
  pagePath: "charter.md",
  pageTitle: "Charter",
  editorName: "editor@example.com",
};

beforeEach(() => {
  jest.clearAllMocks();
  watchers.mockResolvedValue(["watcher-subject"]);
  mockDirectory = [];
});

/** The notification a given subject actually received. */
function sentTo(subject: string) {
  return created.mock.calls
    .map(([payload]) => payload)
    .find((payload) => payload.recipientUserSubjects?.includes(subject));
}

describe("parsePageNotifySelection",() => {
  it("keeps a note the editor typed",() => {
    expect(parsePageNotifySelection({ users: [],note: "  Needs your sign-off  " }))
      .toMatchObject({ note: "Needs your sign-off" });
  });

  it("flattens a pasted note to one line",() => {
    expect(
      parsePageNotifySelection({ users: [],note: "First line\n\n  second line" }),
    ).toMatchObject({ note: "First line second line" });
  });

  it("clamps an over-long note",() => {
    const note = parsePageNotifySelection({
      users: [],
      note: "x".repeat(PAGE_NOTIFY_NOTE_MAX + 50),
    }).note;

    expect(note).toHaveLength(PAGE_NOTIFY_NOTE_MAX);
  });

  it.each([
    ["an empty string",""],
    ["whitespace only","   \n  "],
    ["a non-string",42],
  ])("drops %s rather than sending a blank message",(_label,note) => {
    expect(parsePageNotifySelection({ users: [],note })).not.toHaveProperty("note");
  });

  it("keeps a message left against one tagged person",() => {
    expect(
      parsePageNotifySelection({
        users: [{ email: "Reviewer@Example.com",note: " Your table, please\n " }],
      }).users,
    ).toEqual([{ email: "reviewer@example.com",note: "Your table, please" }]);
  });

  // The subject is resolved from the directory server-side; honouring a
  // client-supplied one would let a request deliver to anyone.
  it("discards a client-supplied subject",() => {
    expect(
      parsePageNotifySelection({
        users: [{ email: "reviewer@example.com",subject: "someone-else" }],
      }).users[0],
    ).not.toHaveProperty("subject");
  });
});

describe("notifyPageSaved",() => {
  it("sends the editor's note as the message",async () => {
    await notifyPageSaved({
      ...SAVE,
      selection: { team: false,users: [],note: "Numbers changed, please re-read" },
    });

    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Numbers changed, please re-read" }),
    );
  });

  // The page decides whether its own notification matters, using the same
  // label parsing the issue views use.
  it("inherits importance from the page",async () => {
    await notifyPageSaved({
      ...SAVE,
      selection: { team: false,users: [] },
      markdown: "---\ntitle: Charter\nlabels:\n  - critical\n---\n\nBody.",
    });

    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({ needsAttention: true }),
    );
  });

  it("leaves an unlabelled page as ordinary news",async () => {
    await notifyPageSaved({
      ...SAVE,
      selection: { team: false,users: [] },
      markdown: "---\ntitle: Charter\n---\n\nBody.",
    });

    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({ needsAttention: false }),
    );
  });

  // The editor's tick and the page's labels are separate routes to the same
  // mark, so either on its own is enough.
  it("takes importance from the editor's choice",async () => {
    await notifyPageSaved({
      ...SAVE,
      selection: { team: false,important: true,users: [] },
      markdown: "---\ntitle: Charter\n---\n\nBody.",
    });

    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({ needsAttention: true }),
    );
  });

  it("keeps a labelled page important when the editor did not tick it",async () => {
    await notifyPageSaved({
      ...SAVE,
      selection: { team: false,important: false,users: [] },
      markdown: "---\ntitle: Charter\nlabels:\n  - critical\n---\n\nBody.",
    });

    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({ needsAttention: true }),
    );
  });

  it("falls back to the page path when there is no note",async () => {
    await notifyPageSaved({ ...SAVE,selection: { team: false,users: [] } });

    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({ message: "charter.md" }),
    );
  });

  // A note with nobody to read it should not conjure a notification.
  it("stays silent when the save reaches no one",async () => {
    watchers.mockResolvedValue([]);

    await notifyPageSaved({
      ...SAVE,
      selection: { team: false,users: [],note: "Anyone there?" },
    });

    expect(created).not.toHaveBeenCalled();
  });
});

describe("notifyPageSaved with someone tagged in the page body",() => {
  const REVIEWER = { email: "reviewer@example.com",keycloak_sub: "reviewer-subject" };

  beforeEach(() => {
    mockDirectory = [REVIEWER];
  });

  // The whole point of a per-person message: a watcher must not read what was
  // written for the person who was tagged.
  it("keeps the personal message away from watchers",async () => {
    await notifyPageSaved({
      ...SAVE,
      selection: {
        team: false,
        users: [{ email: REVIEWER.email,note: "Your table, please" }],
      },
    });

    expect(sentTo("reviewer-subject")).toMatchObject({
      message: "Your table, please",
      recipientUserSubjects: ["reviewer-subject"],
      mentionSubjects: ["reviewer-subject"],
    });
    expect(sentTo("watcher-subject")).toMatchObject({ message: "charter.md" });
  });

  it("tells someone who is both a watcher and tagged just once",async () => {
    watchers.mockResolvedValue(["reviewer-subject"]);

    await notifyPageSaved({
      ...SAVE,
      selection: { team: false,users: [{ email: REVIEWER.email,note: "Over to you" }] },
    });

    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0][0]).toMatchObject({ message: "Over to you" });
  });

  it("counts both the shared and the personal sends",async () => {
    const outcome = await notifyPageSaved({
      ...SAVE,
      selection: { team: false,users: [{ email: REVIEWER.email,note: "Over to you" }] },
    });

    expect(outcome.notified).toBe(2);
  });

  // Tagging the same person twice in one page is ordinary; it must not become
  // two notifications about one save.
  it("sends one notification however often a person is tagged",async () => {
    await notifyPageSaved({
      ...SAVE,
      selection: {
        team: false,
        users: [
          { email: REVIEWER.email,note: "First ask" },
          { email: REVIEWER.email,note: "Second ask" },
        ],
      },
    });

    expect(created.mock.calls.filter(([p]) => p.message === "First ask")).toHaveLength(1);
    expect(sentTo("reviewer-subject")?.message).toBe("First ask");
  });

  it("leaves a tagged person without a message in the shared notification",async () => {
    await notifyPageSaved({
      ...SAVE,
      selection: { team: false,users: [{ email: REVIEWER.email }],note: "For everyone" },
    });

    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0][0]).toMatchObject({
      message: "For everyone",
      mentionSubjects: ["reviewer-subject"],
    });
    expect(created.mock.calls[0][0].recipientUserSubjects).toEqual(
      expect.arrayContaining(["watcher-subject","reviewer-subject"]),
    );
  });

  it("does not notify the editor who tagged themselves",async () => {
    watchers.mockResolvedValue([]);

    await notifyPageSaved({
      ...SAVE,
      selection: { team: false,users: [{ email: REVIEWER.email,note: "Note to self" }] },
      excludeSubject: "reviewer-subject",
    });

    expect(created).not.toHaveBeenCalled();
  });

  it("reports a tagged email with no CAIPE identity",async () => {
    const outcome = await notifyPageSaved({
      ...SAVE,
      selection: { team: false,users: [{ email: "nobody@example.com",note: "Hello" }] },
    });

    expect(outcome.unresolved).toEqual(["nobody@example.com"]);
  });
});
