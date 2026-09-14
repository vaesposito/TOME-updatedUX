/**
 * GitHub's compare endpoint accepts commit SHAs as well as branch and tag
 * names. Keep this validation broad enough for normal Git refs while
 * rejecting characters that could change the URL or compare expression.
 */
export function isValidReleaseNotesRef(value: string): boolean {
  const ref = value.trim();
  if (!ref || ref.length > 256 || ref === "@") return false;

  const invalidCharacters = new Set(["~", "^", ":", "?", "*", "[", "\\"]);
  for (const character of ref) {
    const codePoint = character.charCodeAt(0);
    if (codePoint <= 0x20 || codePoint === 0x7f || invalidCharacters.has(character)) {
      return false;
    }
  }

  if (
    ref.startsWith("/") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.endsWith(".lock") ||
    ref.includes("..") ||
    ref.includes("@{")
  ) {
    return false;
  }
  return true;
}
