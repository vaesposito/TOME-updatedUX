"use client";

import { Eye, ShieldCheck, Users, WifiOff } from "lucide-react";
import * as React from "react";

import {
  HomeCard,
  HomeEmpty,
  HomeSkeleton,
  homeAction,
} from "@/components/tome/home/HomeCard";
import { cn } from "@/lib/utils";

/**
 * Who works on this project.
 *
 * The roster of the owning team, which is also the set of people who can read
 * the project — so this doubles as the answer to "who can see this". The data
 * steward is called out because that is the one person or team who can change
 * it, and watchers are counted because being entitled to a space and actually
 * following it are different things.
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
  settingsHref,
  onOpenSettings,
}: {
  slug: string;
  /** Where a team is assigned and the steward is set. */
  settingsHref: string;
  onOpenSettings?: () => void;
}) {
  const [roster, setRoster] = React.useState<Roster | null>(null);
  const [failed, setFailed] = React.useState(false);
  /** Bumped by Try again, which is the whole of the retry. */
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
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
  const settings = homeAction("Settings", settingsHref, onOpenSettings);

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
                  ? "1 person is watching"
                  : `${roster.watchers} people are watching`}
              </span>
            </p>
          </div>
        </div>
      )}
    </HomeCard>
  );
}
