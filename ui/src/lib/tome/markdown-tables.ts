import { parseFrontmatter } from "@/lib/tome/schema";

/**
 * Reading tables back out of the curated pages.
 *
 * TOME's stable pages carry some of a project's most useful facts — its
 * milestones, its KPIs — as markdown tables with fixed column headings,
 * written from a template by people and by the ingest agent. Nothing stores
 * those rows as data, so anything wanting to show a milestone has to read the
 * page it was written on.
 *
 * This does that reading and nothing more. In particular no date is
 * interpreted and no order is imposed: targets are written as a human would
 * say them ("Q2 FY26", "Jul'26"), the template asks for the rows in target
 * order, and so the author's order is the intended one.
 */

/** A table as written: its headings, and a cell per column per row. */
export interface MarkdownTable {
  headers: string[];
  rows: string[][];
}

const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const HEADING = /^#{2,3}\s+(.+?)\s*$/gm;
const SEPARATOR_CELL = /^:?-+:?$/;

/**
 * Split one row on its pipes.
 *
 * The outer pipes of `| a | b |` produce an empty cell at each end, which is
 * punctuation rather than content; a row written without them is just as
 * valid, so only genuinely empty ends are dropped.
 */
function cells(line: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    // An escaped pipe is content. Unescaped here, because a reader of the
    // rendered page sees a pipe.
    if (char === "\\" && line[index + 1] === "|") {
      current += "|";
      index++;
      continue;
    }
    if (char === "|") {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  if (parts.length > 1 && parts[0].trim() === "") parts.shift();
  if (parts.length > 1 && parts[parts.length - 1].trim() === "") parts.pop();
  return parts.map((part) => part.trim());
}

function isSeparator(row: string[]): boolean {
  return row.length > 0 && row.every((cell) => SEPARATOR_CELL.test(cell));
}

/**
 * A cell as a reader of the rendered page would see it.
 *
 * Authors mark cells up — a linked owner, a bolded status — and a widget
 * showing the cell as a chip wants the words, not the syntax.
 */
export function cellText(cell: string): string {
  return cell
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A heading reduced to the word a lookup asks for.
 *
 * The templates qualify their headings — "Target (Qtr / Month)" — and a
 * caller wanting the target column should not have to repeat the
 * parenthetical, which is guidance to whoever fills the table in and is
 * liable to be reworded.
 */
function headerKey(header: string): string {
  return cellText(header)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The body of one `##` or `###` section, up to the next heading. */
export function sectionBody(markdown: string, heading: string): string {
  const [, body] = parseFrontmatter(markdown);
  const want = headerKey(heading);
  const headings = [...body.matchAll(HEADING)];
  for (let index = 0; index < headings.length; index++) {
    if (headerKey(headings[index][1].replace(/:$/, "")) !== want) continue;
    const start = (headings[index].index ?? 0) + headings[index][0].length;
    const end =
      index + 1 < headings.length
        ? headings[index + 1].index ?? body.length
        : body.length;
    return body.slice(start, end).trim();
  }
  return "";
}

/** The first table in a stretch of markdown, or null if it holds none. */
export function parseMarkdownTable(markdown: string): MarkdownTable | null {
  const lines = markdown.replace(HTML_COMMENT, "").split("\n");
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].includes("|")) continue;
    const next = lines[index + 1];
    if (!next?.includes("|") || !isSeparator(cells(next))) continue;

    const rows: string[][] = [];
    for (let row = index + 2; row < lines.length; row++) {
      if (!lines[row].includes("|")) break;
      const parsed = cells(lines[row]);
      // The templates ship one blank row to show the shape. It says nothing,
      // and a widget would draw it as a row that had lost its contents.
      if (parsed.every((cell) => cell === "")) continue;
      rows.push(parsed);
    }
    return { headers: cells(lines[index]), rows };
  }
  return null;
}

/** The table under a named section, or null if either is missing. */
export function tableUnder(
  markdown: string,
  heading: string,
): MarkdownTable | null {
  const body = sectionBody(markdown, heading);
  return body ? parseMarkdownTable(body) : null;
}

/**
 * One row's value for the first of `names` the table has a column for.
 *
 * Several names rather than one because these headings are prose that a team
 * may reword — "Milestone" could reasonably read "Outcome" — and a column
 * that has been renamed should cost a widget a missing field, not a wrong
 * one taken from whichever column happened to sit at that index.
 */
export function column(
  table: MarkdownTable,
  row: string[],
  ...names: string[]
): string {
  const keys = table.headers.map(headerKey);
  for (const name of names) {
    const index = keys.indexOf(headerKey(name));
    if (index !== -1) return cellText(row[index] ?? "");
  }
  return "";
}
