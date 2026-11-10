"use client";

import { Loader2, Plus, X } from "lucide-react";
import * as React from "react";

import { ProviderLogo } from "@/components/credentials/provider-logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TeamPicker, type TeamPickerOption } from "@/components/ui/team-picker";
import { UserEmailPicker } from "@/components/ui/user-email-picker";
import { getConfig } from "@/lib/config";
import {
  createRequestFrom,
  emptyDraft,
  invitationsToSend,
  kindsFor,
  sentSources,
  type FunctionOption,
  type Invitation,
  type SourceKind,
  type SpaceDraft,
  type SpaceKind,
  type SpacePlacement,
} from "@/lib/projects/space-creation";
import { describeSchedule } from "@/lib/tome/auto-ingest/schedule-presets";
import { cn } from "@/lib/utils";
import type { ProjectDocument } from "@/types/projects";

/**
 * Making a space, on either axis.
 *
 * Three steps and no more: what it is called, what it reads, and who is in
 * it. One component for both tabs because making a project and making a
 * subject are the same act — the only difference is which axis the result
 * sits on, and that is carried in rather than asked for.
 *
 * Plain fields in the app's own dialog, not a decorated wizard: a form that
 * puts a card around every question is a form that makes three questions
 * look like a project of its own. Where it is in the three is said once, in
 * a line of text and a rule, and the step says the rest.
 */

const KIND_LABEL: Record<SpaceKind, string> = {
  project: "Project",
  area: "Area",
  bhag: "BHAG",
  subject: "Subject",
};

const SOURCE_KINDS: { kind: SourceKind; label: string; provider: string; hint: string }[] = [
  {
    kind: "github",
    label: "GitHub",
    provider: "github",
    hint: "example-org/example-repo",
  },
  {
    kind: "confluence",
    label: "Confluence",
    provider: "atlassian",
    hint: "Space key or name",
  },
  { kind: "webex", label: "Webex", provider: "webex", hint: "Room name" },
  {
    kind: "sharepoint",
    label: "SharePoint",
    provider: "sharepoint",
    hint: "Document or library",
  },
];

const STEPS = [
  { title: "General", blurb: "What it is, and what it is called." },
  { title: "Connect sources", blurb: "What it reads, and how often." },
  { title: "Invite team", blurb: "Who is in it, and who runs it." },
] as const;

/** What became of one invitation once the space existed. */
interface InviteOutcome {
  invitation: Invitation;
  state: "sent" | "refused" | "unsupported";
  detail?: string;
}

export function SpaceCreationFlow({
  open,
  onOpenChange,
  placement,
  functionOptions,
  defaultTeamSlug,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent for the catalogue; a function and category for a subject. */
  placement?: SpacePlacement;
  /** Where a subject may be put, when the reader is the one choosing. */
  functionOptions?: FunctionOption[];
  /** A sibling space's team, so the one unguessable field starts filled. */
  defaultTeamSlug?: string;
  onCreated?: (project: ProjectDocument) => void;
}) {
  const [stepIndex, setStepIndex] = React.useState(0);
  const [draft, setDraft] = React.useState<SpaceDraft>(() => emptyDraft(placement));
  const [teams, setTeams] = React.useState<TeamPickerOption[]>([]);
  const [teamsLoading, setTeamsLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [outcomes, setOutcomes] = React.useState<InviteOutcome[] | null>(null);

  const kinds = kindsFor(placement);
  const step = STEPS[stepIndex];
  const edit = (patch: Partial<SpaceDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  React.useEffect(() => {
    if (!open) return;
    setStepIndex(0);
    setDraft(emptyDraft(placement));
    setOutcomes(null);
    setError(null);
    // Placement is read once per opening on purpose: a reader part-way
    // through a subject should not have it move under them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    let live = true;
    setTeamsLoading(true);
    fetch("/api/dynamic-agents/teams")
      .then((res) => res.json())
      .then((data) => {
        if (!live) return;
        const list = (data.data ?? data.teams ?? []) as Array<{
          _id: string;
          name: string;
          slug?: string;
        }>;
        setTeams(
          list.map((team) => ({
            slug: team.slug ?? team._id,
            name: team.name,
            id: team._id,
            _id: team._id,
          })),
        );
        // The sibling's team first, then the deployment's catchall, then
        // whatever is there: never replacing a choice already made.
        const has = (slug: string | undefined) =>
          Boolean(slug) && list.some((team) => (team.slug ?? team._id) === slug);
        const configured = getConfig("defaultTeamSlug");
        const fallback =
          (has(defaultTeamSlug) && defaultTeamSlug) ||
          (has(configured) && configured) ||
          list[0]?.slug ||
          list[0]?._id ||
          "";
        setDraft((current) =>
          current.teamSlug ? current : { ...current, teamSlug: fallback },
        );
      })
      .catch(() => live && setTeams([]))
      .finally(() => live && setTeamsLoading(false));
    return () => {
      live = false;
    };
  }, [open, defaultTeamSlug]);

  async function create() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createRequestFrom(draft)),
      });
      const body = await res.json();
      if (!res.ok || !body.data?.project) {
        throw new Error(body.error ?? body.message ?? "Failed to create the space");
      }
      const created = body.data.project as ProjectDocument;

      const sent = await sendInvitations();
      onCreated?.(created);
      // Shown rather than navigated past when anything did not land: a
      // refused invitation that scrolls away is a person who quietly has no
      // access.
      if (sent.some((outcome) => outcome.state !== "sent")) {
        setOutcomes(sent);
        setSaving(false);
        return;
      }
      onOpenChange(false);
      window.location.href = `/projects/${created.slug}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  /**
   * Hand the invitations to the one path that grants access here.
   *
   * People are added to the space's owning team with the role they were
   * given, which is how view and admin are actually held. A second group has
   * no such path — a space carries one owning team and nothing grants
   * another one access — so those are reported undone, not reported sent.
   */
  async function sendInvitations(): Promise<InviteOutcome[]> {
    const team = teams.find((option) => option.slug === draft.teamSlug);
    const results: InviteOutcome[] = [];
    for (const invitation of invitationsToSend(draft)) {
      if (invitation.kind === "group") {
        results.push({
          invitation,
          state: "unsupported",
          detail:
            "A space has one owning team, and nothing grants a second group access to one. An admin has to do this.",
        });
        continue;
      }
      if (!team?._id) {
        results.push({
          invitation,
          state: "refused",
          detail: "The owning team could not be resolved.",
        });
        continue;
      }
      try {
        const res = await fetch(`/api/admin/teams/${team._id}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: invitation.subject.trim(),
            role: invitation.role,
          }),
        });
        if (res.ok) {
          results.push({ invitation, state: "sent" });
        } else {
          const body = await res.json().catch(() => ({}));
          results.push({
            invitation,
            state: "refused",
            detail: body.error ?? `Refused (${res.status}).`,
          });
        }
      } catch (err) {
        results.push({
          invitation,
          state: "refused",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }

  const canContinue = stepIndex !== 0 || Boolean(draft.name.trim() && draft.teamSlug);
  const onLastStep = stepIndex === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{outcomes ? "Created" : step.title}</DialogTitle>
          <DialogDescription>
            {outcomes
              ? "The space exists. Not everything could be done from here."
              : step.blurb}
          </DialogDescription>
        </DialogHeader>

        {/* Where you are, in a rule rather than a row of decorated circles. */}
        {!outcomes && (
          <div className="flex items-center gap-2">
            {STEPS.map((entry, index) => (
              <span
                key={entry.title}
                className={cn(
                  "h-0.5 flex-1 rounded-full transition",
                  index <= stepIndex ? "bg-primary" : "bg-border",
                )}
              />
            ))}
            <span className="shrink-0 text-xs text-muted-foreground">
              {stepIndex + 1} of {STEPS.length}
            </span>
          </div>
        )}

        <div className="max-h-[55vh] space-y-5 overflow-y-auto">
          {outcomes ? (
            <Outcomes outcomes={outcomes} />
          ) : stepIndex === 0 ? (
            <GeneralStep
              draft={draft}
              kinds={kinds}
              functionOptions={functionOptions}
              teams={teams}
              teamsLoading={teamsLoading}
              onChange={edit}
            />
          ) : stepIndex === 1 ? (
            <SourcesStep draft={draft} onChange={edit} />
          ) : (
            <InviteStep
              draft={draft}
              teams={teams}
              teamsLoading={teamsLoading}
              onChange={edit}
            />
          )}
        </div>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          <div>
            {stepIndex > 0 && !outcomes && (
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => setStepIndex(stepIndex - 1)}
              >
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {outcomes ? (
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            ) : (
              <>
                {/* A step that can be left undone offers leaving it, rather
                    than leaving the reader to guess that Continue will. */}
                {stepIndex === 1 && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      edit({ sources: [], scheduleEnabled: false });
                      setStepIndex(2);
                    }}
                  >
                    Do it later
                  </Button>
                )}
                <Button
                  disabled={!canContinue || saving}
                  onClick={() => (onLastStep ? void create() : setStepIndex(stepIndex + 1))}
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {onLastStep
                    ? saving
                      ? "Creating…"
                      : `Create ${KIND_LABEL[draft.kind].toLowerCase()}`
                    : "Continue"}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GeneralStep({
  draft,
  kinds,
  functionOptions,
  teams,
  teamsLoading,
  onChange,
}: {
  draft: SpaceDraft;
  kinds: SpaceKind[];
  functionOptions?: FunctionOption[];
  teams: TeamPickerOption[];
  teamsLoading: boolean;
  onChange: (patch: Partial<SpaceDraft>) => void;
}) {
  const chosen = functionOptions?.find(
    (option) => option.name === draft.placement?.function,
  );
  const placing = draft.kind === "subject" && (functionOptions?.length ?? 0) > 0;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="space-type">Type</Label>
        {kinds.length > 1 ? (
          <Select
            id="space-type"
            value={draft.kind}
            onChange={(kind) => onChange({ kind: kind as SpaceKind })}
            options={kinds.map((kind) => ({ value: kind, label: KIND_LABEL[kind] }))}
          />
        ) : (
          // One kind means no choice to offer, only a fact to state.
          <p className="text-sm text-muted-foreground">
            {KIND_LABEL[draft.kind]}
            {draft.placement?.category
              ? `, in ${draft.placement.category}`
              : draft.placement?.function
                ? `, in ${draft.placement.function}`
                : ""}
          </p>
        )}
      </div>

      {/* Where it goes, asked here because the button that opened this no
          longer hangs off the row that would have said. */}
      {placing && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="space-function">Function</Label>
            <Select
              id="space-function"
              value={draft.placement?.function ?? ""}
              onChange={(name) => onChange({ placement: { function: name } })}
              options={(functionOptions ?? []).map((option) => ({
                value: option.name,
                label: option.name,
              }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="space-category">Category</Label>
            <Select
              id="space-category"
              value={draft.placement?.category ?? ""}
              onChange={(name) =>
                onChange({
                  placement: {
                    function: draft.placement?.function ?? "",
                    ...(name ? { category: name } : {}),
                  },
                })
              }
              options={[
                { value: "", label: "No category" },
                ...(chosen?.categories ?? []).map((name) => ({
                  value: name,
                  label: name,
                })),
              ]}
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="space-name">Name</Label>
        <Input
          id="space-name"
          autoFocus
          value={draft.name}
          placeholder="What this space is called"
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="space-description">Description</Label>
        <Input
          id="space-description"
          value={draft.description}
          placeholder="One sentence on what it covers"
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>

      {/* Not a fourth question: shown because the endpoint needs one and a
          reader should see which, but answered from the spaces around it. */}
      {!teamsLoading && !draft.teamSlug && (
        <div className="space-y-2">
          <Label htmlFor="space-team">Team</Label>
          <TeamPicker
            id="space-team"
            ariaLabel="Team"
            options={teams}
            value={draft.teamSlug}
            onChange={(teamSlug) => onChange({ teamSlug })}
            placeholder="Choose a team"
          />
        </div>
      )}
    </div>
  );
}

function SourcesStep({
  draft,
  onChange,
}: {
  draft: SpaceDraft;
  onChange: (patch: Partial<SpaceDraft>) => void;
}) {
  const [kind, setKind] = React.useState<SourceKind>("github");
  const [value, setValue] = React.useState("");
  const hint = SOURCE_KINDS.find((entry) => entry.kind === kind)?.hint ?? "";

  const add = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onChange({
      sources: [
        ...draft.sources,
        { id: `${kind}-${trimmed}-${draft.sources.length}`, kind, value: trimmed },
      ],
    });
    setValue("");
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="source-kind">Add a source</Label>
        <div className="flex gap-2">
          <Select
            id="source-kind"
            value={kind}
            onChange={(next) => setKind(next as SourceKind)}
            options={SOURCE_KINDS.map((entry) => ({
              value: entry.kind,
              label: entry.label,
            }))}
            className="w-36 shrink-0"
          />
          <Input
            aria-label="Source"
            value={value}
            placeholder={hint}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button
            variant="outline"
            className="shrink-0 gap-1.5"
            onClick={add}
            disabled={!value.trim()}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </div>

      {draft.sources.length > 0 && (
        <ul className="space-y-1">
          {draft.sources.map((source) => (
            <li key={source.id} className="flex items-center gap-2 py-1 text-sm">
              <ProviderLogo
                provider={
                  SOURCE_KINDS.find((entry) => entry.kind === source.kind)?.provider ??
                  source.kind
                }
                className="h-4 w-4 shrink-0 object-contain"
              />
              <span className="min-w-0 flex-1 truncate">{source.value}</span>
              <button
                type="button"
                aria-label={`Remove ${source.value}`}
                onClick={() =>
                  onChange({
                    sources: draft.sources.filter((entry) => entry.id !== source.id),
                  })
                }
                className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Said here rather than discovered later: everything but a repository
          has to be chosen from the live account in the space's settings,
          which is where the picker can see what you actually have. */}
      {draft.sources.length > sentSources(draft.sources).length && (
        <p className="text-xs text-muted-foreground">
          Repositories are attached when the space is created. Confluence,
          Webex and SharePoint are noted here, and attached from the
          space&apos;s own settings, where they can be picked from your
          connected account.
        </p>
      )}

      <div className="space-y-2 border-t border-border/60 pt-4">
        <button
          type="button"
          onClick={() => onChange({ scheduleEnabled: !draft.scheduleEnabled })}
          aria-pressed={draft.scheduleEnabled}
          className="flex w-full items-center gap-2.5 text-left"
        >
          <span
            className={cn(
              "h-4 w-4 shrink-0 rounded border transition",
              draft.scheduleEnabled ? "border-primary bg-primary" : "border-border",
            )}
          />
          <span className="text-sm">Scheduled ingests</span>
          <span className="text-xs text-muted-foreground">
            {describeSchedule(draft.schedule)}
          </span>
        </button>

        {draft.scheduleEnabled && (
          <div className="flex gap-2 pl-6">
            {(["weekly", "daily"] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={draft.schedule.preset === preset}
                onClick={() => onChange({ schedule: { ...draft.schedule, preset } })}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition",
                  draft.schedule.preset === preset
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent/40",
                )}
              >
                {preset}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InviteStep({
  draft,
  teams,
  teamsLoading,
  onChange,
}: {
  draft: SpaceDraft;
  teams: TeamPickerOption[];
  teamsLoading: boolean;
  onChange: (patch: Partial<SpaceDraft>) => void;
}) {
  const add = (kind: Invitation["kind"]) =>
    onChange({
      invitations: [
        ...draft.invitations,
        {
          id: `${kind}-${draft.invitations.length}`,
          kind,
          subject: "",
          role: "member",
        },
      ],
    });

  const patch = (id: string, next: Partial<Invitation>) =>
    onChange({
      invitations: draft.invitations.map((invite) =>
        invite.id === id ? { ...invite, ...next } : invite,
      ),
    });

  const drop = (id: string) =>
    onChange({
      invitations: draft.invitations.filter((invite) => invite.id !== id),
    });

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="owning-team">Owning team</Label>
        <TeamPicker
          id="owning-team"
          ariaLabel="Owning team"
          options={teams}
          value={draft.teamSlug}
          onChange={(teamSlug) => onChange({ teamSlug })}
          loading={teamsLoading}
          placeholder="Choose a team"
        />
        <p className="text-xs text-muted-foreground">
          Everyone in this team can see the space. Invited people are added to
          it.
        </p>
      </div>

      {draft.invitations.map((invite) => (
        <div key={invite.id} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            {invite.kind === "group" ? (
              <TeamPicker
                ariaLabel="Group to invite"
                options={teams}
                value={invite.subject}
                onChange={(subject) => patch(invite.id, { subject })}
                loading={teamsLoading}
                placeholder="Choose a group"
              />
            ) : (
              <UserEmailPicker
                value={invite.subject}
                onChange={(subject) => patch(invite.id, { subject })}
                placeholder="name@example.com"
              />
            )}
          </div>
          <Select
            value={invite.role}
            onChange={(role) => patch(invite.id, { role: role as Invitation["role"] })}
            options={[
              { value: "member", label: "Non-admin" },
              { value: "admin", label: "Admin" },
            ]}
            className="w-32 shrink-0"
            ariaLabel="Role"
          />
          <button
            type="button"
            aria-label="Remove"
            onClick={() => drop(invite.id)}
            className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => add("group")}>
          <Plus className="h-3.5 w-3.5" />
          Add group
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => add("user")}>
          <Plus className="h-3.5 w-3.5" />
          Add person
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        The first admin becomes this space&apos;s data steward, who can write
        to it and run its ingests. Everyone else is added to the owning team
        with the role given, which needs you to administer that team.
      </p>
    </div>
  );
}

function Outcomes({ outcomes }: { outcomes: InviteOutcome[] }) {
  return (
    <ul className="space-y-3">
      {outcomes.map((outcome) => (
        <li key={outcome.invitation.id} className="space-y-1">
          <p className="text-sm font-medium">
            {outcome.invitation.subject}{" "}
            <span className="font-normal text-muted-foreground">
              {outcome.invitation.role === "admin" ? "admin" : "non-admin"}
            </span>
          </p>
          {outcome.detail && (
            <p className="text-xs text-muted-foreground">{outcome.detail}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The app's input, worn as a select: one control, two kinds of answer. */
function Select({
  id,
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
