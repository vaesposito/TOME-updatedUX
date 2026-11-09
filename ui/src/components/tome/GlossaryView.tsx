"use client";

import { BookA, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PanelShell } from "@/components/tome/PanelHeader";
import { TomeEmpty } from "@/components/tome/TomeEmpty";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The words this space uses, and what they mean.
 *
 * The terms are ordinary wiki pages — one file per term under `glossary/`,
 * typed in their frontmatter — but nobody reads a glossary as a list of
 * filenames. So they are shown as a vocabulary: the word, what it stands
 * for, and the sentence that defines it, in alphabetical order.
 *
 * A search box, unlike everywhere else in TOME: a glossary is the one place
 * a reader arrives already knowing the word they want, and scanning a
 * hundred terms for it is the whole cost the page exists to remove.
 */

/** One term entry, as the glossary route reports it. */
export interface GlossaryEntry {
  path: string;
  term: string;
  expansion: string | null;
  aliases: string[];
  scope: string | null;
  termKind: string | null;
  status: string | null;
  definition: string;
}

export function GlossaryView({
  slug,
  onOpenPage,
}: {
  slug: string;
  /** Opens the term's own page, where it can be edited. */
  onOpenPage: (path: string) => void;
}) {
  const [terms, setTerms] = useState<GlossaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/tome/projects/${encodeURIComponent(slug)}/glossary`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("Could not load this space's glossary.");
      setTerms(body?.data?.terms ?? []);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load this space's glossary.",
      );
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const matching = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return terms;
    // Aliases and expansions too: a reader looking up an acronym they only
    // half remember is as likely to type what it stands for.
    return terms.filter((entry) =>
      [entry.term, entry.expansion ?? "", ...entry.aliases]
        .join(" ")
        .toLowerCase()
        .includes(wanted),
    );
  }, [terms, query]);

  return (
    <PanelShell
      title="Glossary"
      description="The words this space uses, and what they mean. Each term is a page the agent keeps up to date as it reads."
      titleAccessory={
        terms.length > 0 ? (
          <span className="text-xs font-normal text-muted-foreground">
            {terms.length} {terms.length === 1 ? "term" : "terms"}
          </span>
        ) : undefined
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading the glossary…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : terms.length === 0 ? (
        <TomeEmpty
          icon={<BookA />}
          headline="No terms yet"
          hint="Terms are written as the agent reads this space's sources. An acronym it meets twice ends up defined here."
        />
      ) : (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label="Find a term"
              placeholder="Find a term"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
            />
          </div>

          {matching.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              No term matches “{query.trim()}”.
            </p>
          ) : (
            <dl className="divide-y">
              {matching.map((entry) => (
                <div key={entry.path} className="py-4">
                  <dt className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <button
                      type="button"
                      onClick={() => onOpenPage(entry.path)}
                      className="text-sm font-medium text-foreground transition-colors hover:text-primary"
                    >
                      {entry.term}
                    </button>

                    {/* What an acronym stands for belongs beside it, not in
                        the definition: it is the first thing a reader wants
                        and the shortest thing to say. */}
                    {entry.expansion && (
                      <span className="text-sm text-muted-foreground">
                        {entry.expansion}
                      </span>
                    )}

                    {entry.status === "deprecated" && (
                      <Mark tone="warn">Deprecated</Mark>
                    )}
                    {/* Only when it reaches past this space: a project-scoped
                        term in a project's own glossary says nothing. */}
                    {entry.scope && entry.scope !== "project" && (
                      <Mark>{entry.scope === "org" ? "Organisation" : entry.scope}</Mark>
                    )}
                  </dt>

                  {entry.definition && (
                    <dd className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                      {entry.definition}
                    </dd>
                  )}

                  {entry.aliases.length > 0 && (
                    <dd className="mt-1.5 text-xs text-muted-foreground">
                      Also called {entry.aliases.join(", ")}
                    </dd>
                  )}
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </PanelShell>
  );
}

/** A quiet note about a term, set apart from its meaning. */
function Mark({
  tone = "plain",
  children,
}: {
  tone?: "plain" | "warn";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] capitalize",
        tone === "warn"
          ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
          : "border-border text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
