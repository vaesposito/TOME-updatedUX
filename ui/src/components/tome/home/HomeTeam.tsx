"use client";

import { Eye, ShieldCheck, Users, WifiOff } from "lucide-react";
import * as React from "react";

import {
  HomeCard,
  HomeEmpty,
  HomeSkeleton,
  homeAction,
} from "@/components/tome/home/HomeCard";
import type { ChildRow } from "@/components/tome/home/HomeChildren";
import { cn } from "@/lib/utils";

/**
 * Who works on this space.
 *
 * On a project: the roster of the owning team, which is also the set of
 * people who can read it — so this doubles as the answer to "who can see
 * this". The data steward is called out because that is the one person or
 * team who can change it, and watchers are counted because being entitled to
 * a space and actually following it are different things.
 *
 * On a BHAG or an Area a roster is the wrong answer: nobody is a member of a
 * goal. The question there is who to go to about anything underneath it, so
 * given the spaces below, the card names the stewards and owners across them
 * instead, each with the role that makes them worth asking.
 */

interface Member {
  email: string;
  name: string;
  avatar_url: string | null;
  role: "owner" | "admin" | "member";
  idp_managed: boolean;
}

interface Roster {
  team: { slug: string; name: string } | null;
  members: Member[];
  total: number;
  steward: string | null;
  watchers: number;
}

const SHOWN = 6;

/** How many people a roll-up names before it reports the rest as a count. */
const SHOWN_ROLLUP = 8;

/** Why this person is worth asking, strongest claim first. */
const ROLES = ["steward", "owner", "team"] as const;

type RollupRole = (typeof ROLES)[number];

interface Principal {
  label: string;
  role: RollupRole;
}

/** A space, reduced to whoever answers for it. */
interface Answerable {
  steward?: string | null;
  owner?: string | null;
  team?: { name: string } | null;
}

/**
 * Everyone answerable for anything below this space, named once.
 *
 * Deduplicated by name and kept at the strongest claim: one person stewarding
 * four projects is one row, and a steward who also created the space is a
 * steward, because that is the role that decides who may change it.
 */
function rollupPrincipals(spaces: readonly Answerable[]): Principal[] {
  const strongest = new Map<string, Principal>();
  const add = (label: string | null | undefined, role: RollupRole) => {
    const name = label?.trim();
    if (!name) return;
    const key = name.toLowerCase();
    const found = strongest.get(key);
    if (found && ROLES.indexOf(found.role) <= ROLES.indexOf(role)) return;
    strongest.set(key, { label: name, role });
  };
  for (const space of spaces) {
    add(space.steward, "steward");
    add(space.owner, "owner");
    add(space.team?.name, "team");
  }
  return [...strongest.values()].sort(
    (a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role),
  );
}

/** A name reduced to the one or two letters an avatar has room for. */
function initials(member: Member): string {
  const source = member.name || member.email;
  const words = source
    .replace(/@.*$/, "")
    .split(/[\s._-]+/u)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

export function HomeTeam({
  slug,
  rollup,
  settingsHref,
  onOpenSettings,
  actionLabel,
}: {
  /** Whose roster to read. Absent where no single space is in view. */
  slug?: string;
  /**
   * The spaces below this one, when the card is read at a roll-up altitude.
   *
   * `undefined` on a project, which has nothing below it to roll up, and
   * `null` while the list is still on its way.
   */
  rollup?: readonly ChildRow[] | null;
  /** Where a team is assigned and the steward is set. */
  settingsHref: string;
  onOpenSettings?: () => void;
  /**
   * What to call the way out, where "settings" is not it.
   *
   * With no single space in view there are no settings to open from here,
   * and the way on is the list of spaces.
   */
  actionLabel?: string;
}) {
  const [roster, setRoster] = React.useState<Roster | null>(null);
  const [failed, setFailed] = React.useState(false);
  /** Bumped by Try again, which is the whole of the retry. */
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setFailed(false);
    fetch(`/api/tome/projects/${encodeURIComponent(slug)}/team`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body) => {
        if (!cancelled) setRoster((body?.data ?? body) as Roster);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, attempt]);

  const members = roster?.members ?? [];
  const hidden = Math.max(0, (roster?.total ?? 0) - members.length);
  const settings = homeAction(
    actionLabel ?? "Settings",
    settingsHref,
    onOpenSettings,
  );

  /**
   * Who to go to, across everything below — this space's own steward and team
   * among them, since a container is answerable for itself as well.
   *
   * A roster that did not come back is not fatal here: the roll-up is mostly
   * the children's, so the card names who it can rather than refusing to
   * answer at all.
   */
  const principals = React.useMemo(
    () =>
      rollup
        ? rollupPrincipals([
            ...(roster ? [{ steward: roster.steward, team: roster.team }] : []),
            ...rollup,
          ])
        : [],
    [rollup, roster],
  );

  if (rollup !== undefined) {
    return (
      <HomeCard
        title="People"
        icon={<Users className="h-4 w-4" />}
        count={principals.length}
        action={settings}
      >
        {rollup === null || (slug && !roster && !failed) ? (
          <HomeSkeleton rows={4} />
        ) : principals.length === 0 ? (
          <HomeEmpty
            icon={<ShieldCheck />}
            headline="Nobody is named yet"
            hint="The steward and owner of each space below appear here, so a reader knows who to ask about any of them."
            action={settings}
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {principals.slice(0, SHOWN_ROLLUP).map((principal) => (
              <li
                key={`${principal.role}:${principal.label}`}
                className="flex min-w-0 items-center gap-2"
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground"
                >
                  {principal.role === "team" ? (
                    <Users className="h-3 w-3" />
                  ) : (
                    <ShieldCheck className="h-3 w-3" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs">
                  {principal.label}
                </span>
                <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                  {principal.role}
                </span>
              </li>
            ))}
            {principals.length > SHOWN_ROLLUP ? (
              <li className="text-[11px] text-muted-foreground">
                and {principals.length - SHOWN_ROLLUP} more
              </li>
            ) : null}
          </ul>
        )}
      </HomeCard>
    );
  }

  return (
    <HomeCard
      title="Team"
      icon={<Users className="h-4 w-4" />}
      count={roster?.total}
      action={settings}
    >
      {failed ? (
        <HomeEmpty
          icon={<WifiOff />}
          headline="Could not load the team"
          hint="The roster request did not come back. Nothing else on this page depends on it."
          action={{ label: "Try again", onClick: () => setAttempt((n) => n + 1) }}
        />
      ) : !roster ? (
        <HomeSkeleton rows={4} />
      ) : (
        <div className="flex flex-col gap-3">
          {roster.team && (
            <p className="truncate text-xs font-medium">{roster.team.name}</p>
          )}

          {members.length === 0 ? (
            <HomeEmpty
              icon={<Users />}
              headline={
                roster.team
                  ? "No members on record yet"
                  : "No team owns this space yet"
              }
              hint={
                roster.team
                  ? "The owning team's roster appears here, with each person's role."
                  : "Assigning a team gives the project its roster and decides who can read it."
              }
              action={settings}
            />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {members.slice(0, SHOWN).map((member) => (
                <li key={member.email} className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-[10px] font-medium text-muted-foreground",
                    )}
                  >
                    {member.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={member.avatar_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      initials(member)
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs" title={member.email}>
                    {member.name}
                  </span>
                  {member.role !== "member" && (
                    <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                      {member.role}
                    </span>
                  )}
                </li>
              ))}
              {hidden > 0 && (
                <li className="text-[11px] text-muted-foreground">
                  and {hidden} {hidden === 1 ? "other" : "others"}
                </li>
              )}
            </ul>
          )}

          <div className="flex flex-col gap-1 border-t pt-2.5 text-[11px] text-muted-foreground">
            <p className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {roster.steward
                  ? `${roster.steward} can edit`
                  : "No data steward assigned"}
              </span>
            </p>
            <p className="flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {roster.watchers === 1
                  ? "1 person is following"
                  : `${roster.watchers} people are following`}
              </span>
            </p>
          </div>
        </div>
      )}
    </HomeCard>
  );
}
