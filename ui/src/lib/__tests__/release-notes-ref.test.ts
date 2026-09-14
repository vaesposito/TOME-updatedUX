import { isValidReleaseNotesRef } from "../release-notes-ref";

describe("isValidReleaseNotesRef", () => {
  it.each([
    "1111111",
    "a".repeat(40),
    "a".repeat(64),
    "v1.2.3",
    "release/1.2",
    "refs/tags/v1.2.3",
    "feature/preview-release-notes",
  ])("accepts %s", (ref) => {
    expect(isValidReleaseNotesRef(ref)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "a".repeat(257),
    "release..broken",
    "release/",
    "release~1",
    "release...latest",
    "release@{1}",
  ])("rejects %s", (ref) => {
    expect(isValidReleaseNotesRef(ref)).toBe(false);
  });
});
