"use client";

import { Bell, Check, ChevronDown, Search, X } from "lucide-react";
import * as React from "react";

import { CheckboxMark } from "@/components/notifications/SelectionCheckbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  PAGE_NOTIFY_NOTE_MAX,
  type PageNotifyRecipient,
  type PageNotifySelection,
} from "@/types/tome";

const MIN_QUERY = 2;
const SEARCH_DEBOUNCE_MS = 200;

interface DirectoryResult {
  email: string;
  name?: string;
  subject?: string;
}

function unwrapResults(value: unknown): DirectoryResult[] {
  const body = value as { data?: DirectoryResult[] } | DirectoryResult[] | null;
  if (Array.isArray(body)) return body;
  return Array.isArray(body?.data) ? body.data : [];
}

function label(recipient: PageNotifyRecipient): string {
  return recipient.name?.trim() || recipient.email;
}

/** One independent choice: a box, a name, and a line saying what it does. */
function Toggle({
  label: text,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="-mx-1 flex w-[calc(100%+0.5rem)] items-start gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/60"
    >
      <span className="pt-0.5">
        <CheckboxMark checked={checked} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{text}</span>
        <span className="block text-xs text-foreground/70">{hint}</span>
      </span>
    </button>
  );
}

/**
 * "Notifications" menu in the page editor toolbar: three separate choices
 * about this save, in their own blocks because none of them implies another.
 *
 *  - Notify, on by default, tells the entity's owning team.
 *  - Important, off by default, marks whatever goes out as needing attention.
 *  - Tagging names particular people and gives them a line of their own.
 *
 * Any combination is valid, including all three off. Watchers are notified
 * either way, so an untouched menu is a quiet save, not a silent one.
 *
 * People tagged with `@` in the page body appear here as chips too, since the
 * save carries one list. A chip carrying its own message keeps it, and that
 * person is notified separately rather than through the shared note.
 *
 * Selection lives in the parent so it can ride along with the save request and
 * reset once the page is written.
 */
export function PageNotifyMenu({
  value,
  onChange,
  disabled,
}: {
  value: PageNotifySelection;
  onChange: (next: PageNotifySelection) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<DirectoryResult[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (term.length < MIN_QUERY) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/users/search?q=${encodeURIComponent(term)}`,
        );
        if (!response.ok) throw new Error(`directory search ${response.status}`);
        const found = unwrapResults(await response.json());
        if (!cancelled) setResults(found);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  const selectedEmails = React.useMemo(
    () => new Set(value.users.map((user) => user.email)),
    [value.users],
  );

  const toggleUser = (user: DirectoryResult) => {
    onChange({
      ...value,
      users: selectedEmails.has(user.email)
        ? value.users.filter((picked) => picked.email !== user.email)
        : [...value.users, { email: user.email, name: user.name, subject: user.subject }],
    });
    setQuery("");
  };

  // Counts the tagged, not the notified: with Notify on by default a count
  // that included the team would read "1" on every untouched save and so say
  // nothing. The badge is for what this editor added.
  const taggedCount = value.users.length;
  // Lit whenever the save differs from the default, in either direction, so
  // deliberately silencing one is as visible as adding to it.
  const changed = taggedCount > 0 || value.important || !value.team;
  const term = query.trim();
  const noteId = React.useId();
  const remaining = PAGE_NOTIFY_NOTE_MAX - (value.note?.length ?? 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-tour="page-notify"
          className={cn(
            "flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
            changed ? "text-foreground" : "text-muted-foreground",
          )}
          title="Choose who to notify about this edit"
        >
          <Bell className="h-3.5 w-3.5" aria-hidden="true" />
          Notifications
          {taggedCount > 0 && (
            <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold leading-4 text-foreground">
              {taggedCount}
            </span>
          )}
          <ChevronDown className="h-3 w-3 opacity-50" aria-hidden="true" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 p-0">
        <div className="px-3 py-2">
          <Toggle
            label="Notify"
            hint="Tell the team about this save."
            checked={value.team}
            onChange={(team) => onChange({ ...value, team })}
          />
        </div>

        <div className="border-t px-3 py-2">
          <Toggle
            label="Important"
            hint="Marks it as needing attention."
            checked={value.important}
            onChange={(important) => onChange({ ...value, important })}
          />
        </div>

        <div className="border-t px-3 pb-2 pt-2">
          <p className="pb-1.5 text-sm font-medium">Tag someone</p>
          <p className="pb-1.5 text-xs text-foreground/70">
            They are told whether or not Notify is on. Typing{" "}
            <span className="font-medium text-foreground">@</span> in the page tags
            someone with a message for them alone.
          </p>

          {value.users.length > 0 && (
            <div className="flex flex-wrap gap-1 pb-2">
              {value.users.map((user) => (
                <span
                  key={user.email}
                  className="flex max-w-full items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2 pr-1 text-xs text-primary"
                >
                  <span
                    className="truncate"
                    // Someone tagged in the page body carries a message of
                    // their own, which the chip would otherwise hide.
                    title={user.note ? `${user.email} — "${user.note}"` : user.email}
                  >
                    {label(user)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${label(user)}`}
                    onClick={() =>
                      onChange({
                        ...value,
                        users: value.users.filter((p) => p.email !== user.email),
                      })
                    }
                    className="rounded-full p-0.5 hover:bg-primary/20"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 rounded-md border border-input px-2 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type user name..."
              aria-label="Search people to notify"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {term.length >= MIN_QUERY && (
            <div className="max-h-48 overflow-y-auto pt-1">
              {loading ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">Searching…</p>
              ) : results.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">No matches.</p>
              ) : (
                results.map((user) => (
                  <button
                    key={user.email}
                    type="button"
                    onClick={() => toggleUser(user)}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{user.name || user.email}</span>
                      {user.name && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {user.email}
                        </span>
                      )}
                    </span>
                    {selectedEmails.has(user.email) && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                    )}
                  </button>
                ))
              )}
            </div>
          )}

          <label htmlFor={noteId} className="block pb-1.5 pt-2.5 text-xs text-foreground/70">
            Message
          </label>
          <textarea
            id={noteId}
            value={value.note ?? ""}
            onChange={(event) => onChange({ ...value, note: event.target.value })}
            maxLength={PAGE_NOTIFY_NOTE_MAX}
            rows={2}
            placeholder="Why you're passing this on…"
            className="w-full resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <p className="pb-1 pt-1 text-[11px] text-foreground/70">
            {remaining <= 40
              ? `${remaining} characters left.`
              : "Shown in place of the file path, to everyone without a message of their own."}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
