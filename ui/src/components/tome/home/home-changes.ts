/**
 * A week of a space's feed, read as a list of changes.
 *
 * The feed is a conversation with activity interleaved: a run posts a row
 * when it starts and another when it finishes, a repository posts one per
 * pull request. Read top to bottom that is a record; read as "what changed
 * this week" it is three rows saying one thing happened.
 *
 * So events sharing a `correlation_id` become one row carrying the latest of
 * them, which is the same collapsing the Feed itself does and for the same
 * reason — the producers already reuse the id across a run's transitions, so
 * nothing here needs to know what an ingest is.
 *
 * Pure: messages and a clock go in, rows come out.
 */

/** A feed message, as the feed route returns it. */
export interface FeedEvent {
  id: string;
  content: string;
  message_type: string;
  created_at: string;
  metadata?: {
    kind?: string;
    payload?: Record<string, unknown>;
    correlation_id?: string;
  } | null;
}

export interface ChangeRow {
  id: string;
  /** The event kind, which decides the glyph: `ingest_event` and the rest. */
  kind: string;
  title: string;
  detail?: string;
  at: string;
  /** How many feed messages this one row stands for. */
  collapsed: number;
}

export const CHANGES_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** An unparseable timestamp sorts as the epoch rather than poisoning the
 *  comparison: `NaN` compares false both ways. */
function time(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * What a row says under its title, where the event carries something worth
 * saying. Only fields the producers actually write: a source event names the
 * repository or the provider it came from, and nothing else here has a
 * second line to give.
 */
function detailOf(kind: string, payload: Record<string, unknown> | undefined): string | undefined {
  if (kind !== "source_event" || !payload) return undefined;
  return text(payload.repo) ?? text(payload.source);
}

export function collapseChanges(
  messages: readonly FeedEvent[],
  now: number,
): ChangeRow[] {
  const events = messages
    .filter((message) => message.message_type === "event" && message.metadata?.kind)
    .filter((message) => time(message.created_at) >= now - CHANGES_WINDOW_MS)
    .sort((left, right) => time(right.created_at) - time(left.created_at));

  const rows: ChangeRow[] = [];
  const byCorrelation = new Map<string, ChangeRow>();
  for (const event of events) {
    const kind = event.metadata?.kind ?? "";
    const correlation = event.metadata?.correlation_id;
    // Newest first, so the row a group keeps is already the latest word on
    // it; the rest only raise the count.
    const group = correlation ? byCorrelation.get(correlation) : undefined;
    if (group) {
      group.collapsed += 1;
      continue;
    }
    const row: ChangeRow = {
      id: event.id,
      kind,
      title: event.content,
      detail: detailOf(kind, event.metadata?.payload),
      at: event.created_at,
      collapsed: 1,
    };
    if (correlation) byCorrelation.set(correlation, row);
    rows.push(row);
  }
  return rows;
}
