/**
 * How a tagged person is written into the page body.
 *
 * A plain mailto link rather than a bespoke syntax: it round-trips through
 * every Markdown parser in the stack, renders as a contactable name in the
 * published page, and needs no custom editor schema node to survive a save.
 */
export function mentionMarkdown(person: { email: string; name?: string }): string {
  const label = (person.name?.trim() || person.email).replace(/[[\]\s]+/g, " ").trim();
  // Characters that would close the link early or smuggle in a second URL are
  // dropped rather than escaped, since none of them belong in an address.
  const target = person.email.replace(/[\s<>()[\]]+/g, "");
  return `[@${label || target}](mailto:${target})`;
}
