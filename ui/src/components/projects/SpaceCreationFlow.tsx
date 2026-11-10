"use client";

import { Loader2, Plus, X } from "lucide-react";
import * as React from "react";

import { ProviderLogo } from "@/components/credentials/provider-logo";
import { CheckboxMark } from "@/components/notifications/SelectionCheckbox";
import { LabelComboBox } from "@/components/projects/LabelComboBox";
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
import { Select } from "@/components/ui/select";
import { TeamPicker, type TeamPickerOption } from "@/components/ui/team-picker";
import { UserEmailPicker } from "@/components/ui/user-email-picker";
import { getConfig } from "@/lib/config";
import {
  toHierarchyOptions,
  type HierarchyOption,
  type HierarchyProject,
} from "@/lib/projects/hierarchy-options";
import { normLabel } from "@/lib/projects/labels";
import {
  canonicalLabel,
  canonicalPlacement,
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
  // Which teams this reader administers, as the teams list already reports.
  const [adminOf, setAdminOf] = React.useState<Set<string>>(new Set());
  // The dialog's own node, so a list portalled out of a field still counts
  // as inside it. Held in state rather than a bare ref so the first render
  // after it mounts actually passes it down.
  const [content, setContent] = React.useState<HTMLDivElement | null>(null);
  const [bhags, setBhags] = React.useState<HierarchyOption[]>([]);
  const [areas, setAreas] = React.useState<HierarchyOption[]>([]);
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
          user_role?: string;
        }>;
        setAdminOf(
          new Set(
            list
              .filter((team) => team.user_role === "admin" || team.user_role === "owner")
              .map((team) => team.slug ?? team._id),
          ),
        );
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

  // The BHAGs a project or area could sit under. Not fetched on the function
  // axis, where there is no hierarchy to offer.
  const onFunctionAxis = Boolean(placement?.function);
  React.useEffect(() => {
    if (!open || onFunctionAxis) return;
    let live = true;
    fetch("/api/projects?type=bhag")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!live) return;
        setBhags(toHierarchyOptions((body?.data?.projects ?? []) as HierarchyProject[]));
      })
      .catch(() => live && setBhags([]));
    return () => {
      live = false;
    };
  }, [open, onFunctionAxis]);

  // The areas inside the chosen BHAG, and only those: an area belongs to one
  // BHAG, so offering all of them would offer most of them wrongly.
  const initiative = draft.placement?.initiative;
  React.useEffect(() => {
    if (!open || !initiative) {
      setAreas([]);
      return;
    }
    let live = true;
    fetch(`/api/projects?type=area&initiative=${encodeURIComponent(initiative)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!live) return;
        setAreas(toHierarchyOptions((body?.data?.projects ?? []) as HierarchyProject[]));
      })
      .catch(() => live && setAreas([]));
    return () => {
      live = false;
    };
  }, [open, initiative]);

  async function create() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createRequestFrom(canonicalPlacement(draft, functionOptions ?? [])),
        ),
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
      <DialogContent ref={setContent} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{outcomes ? "Created" : step.title}</DialogTitle>
          <DialogDescription>
            {outcomes
              ? "The space exists. Not everything could be done from here."
              : step.blurb}
          </DialogDescription>
        </DialogHeader>

        {!outcomes && <Stepper at={stepIndex} />}

        <div className="max-h-[55vh] space-y-4 overflow-y-auto px-1">
          {outcomes ? (
            <Outcomes outcomes={outcomes} />
          ) : stepIndex === 0 ? (
            <GeneralStep
              draft={draft}
              kinds={kinds}
              functionOptions={functionOptions}
              bhags={bhags}
              areas={areas}
              teams={teams}
              teamsLoading={teamsLoading}
              container={content}
              onChange={edit}
            />
          ) : stepIndex === 1 ? (
            <SourcesStep draft={draft} onChange={edit} />
          ) : (
            <InviteStep
              draft={draft}
              teams={teams}
              teamsLoading={teamsLoading}
              canInvite={adminOf.has(draft.teamSlug)}
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

/**
 * The three steps, named, with the current one marked.
 *
 * The skill builder's own wizard stepper: a numbered bubble per step, its
 * title beside it, hairline connectors between. Three states and nothing
 * more — the one you are on, the ones you have done, and the ones ahead —
 * because a stepper that decorates further is decorating the chrome rather
 * than saying where you are.
 */
function Stepper({ at }: { at: number }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((entry, index) => {
        const current = index === at;
        const done = index < at;
        return (
          <React.Fragment key={entry.title}>
            <li className="flex shrink-0 items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors",
                  current
                    ? "border-primary bg-primary text-primary-foreground"
                    : done
                      ? "border-primary/60 bg-primary/15 text-primary"
                      : "border-border bg-background text-muted-foreground",
                )}
              >
                {index + 1}
              </span>
              <span
                aria-current={current ? "step" : undefined}
                className={cn(
                  "whitespace-nowrap text-[11px] font-medium",
                  current ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {entry.title}
              </span>
            </li>
            {index < STEPS.length - 1 && (
              <span aria-hidden className="h-px min-w-2 flex-1 bg-border" />
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

function GeneralStep({
  draft,
  kinds,
  functionOptions,
  bhags,
  areas,
  teams,
  teamsLoading,
  container,
  onChange,
}: {
  draft: SpaceDraft;
  kinds: SpaceKind[];
  functionOptions?: FunctionOption[];
  bhags: HierarchyOption[];
  areas: HierarchyOption[];
  teams: TeamPickerOption[];
  teamsLoading: boolean;
  container: HTMLElement | null;
  onChange: (patch: Partial<SpaceDraft>) => void;
}) {
  const place = (patch: Partial<SpacePlacement>) =>
    onChange({ placement: { ...draft.placement, ...patch } });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="space-type">Type</Label>
        {kinds.length > 1 ? (
          <Select
            id="space-type"
            value={draft.kind}
            onChange={(e) => onChange({ kind: e.target.value as SpaceKind })}
          >
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </Select>
        ) : (
          // One kind means no choice to offer, only a fact to state.
          <p className="text-sm text-muted-foreground">{KIND_LABEL[draft.kind]}</p>
        )}
      </div>

      {/* Where it lives: one concern, read the same way on either axis, and
          never showing the other axis's options. Asked here because the
          button that opened this no longer hangs off the row that said. */}
      <Placement
        draft={draft}
        functionOptions={functionOptions}
        bhags={bhags}
        areas={areas}
        container={container}
        onPlace={place}
      />

      <div className="space-y-1">
        <Label htmlFor="space-name">Name</Label>
        <Input
          id="space-name"
          autoFocus
          value={draft.name}
          placeholder="What this space is called"
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>

      <div className="space-y-1">
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
        <div className="space-y-1">
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

/**
 * The two levels a space can be placed at, whichever axis it is on.
 *
 * A BHAG has no parent, so it is offered none. Everything else is offered
 * its own axis's pair and only its own: a project never sees a function, and
 * a subject never sees a BHAG.
 */
/**
 * The combo box wearing the same clothes as every other field in the flow.
 * `Input`'s own classes, so a control that happens to be built differently
 * is not a control that looks different.
 */
const FIELD_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/**
 * Says when a name is a new one.
 *
 * The field accepts either, and the two are worth telling apart: picking an
 * existing function files the subject beside what is already there, while
 * naming a new one makes a group that exists because this subject is in it.
 */
function NewNameHint({
  typed,
  existing,
  what,
}: {
  typed: string;
  existing: readonly string[];
  what: "function" | "category";
}) {
  if (!typed.trim() || canonicalLabel(typed, existing)) return null;
  return (
    <p className="text-xs text-muted-foreground">
      New {what}. It will exist once this subject is filed under it.
    </p>
  );
}

function Placement({
  draft,
  functionOptions,
  bhags,
  areas,
  container,
  onPlace,
}: {
  draft: SpaceDraft;
  functionOptions?: FunctionOption[];
  bhags: HierarchyOption[];
  areas: HierarchyOption[];
  container: HTMLElement | null;
  onPlace: (patch: Partial<SpacePlacement>) => void;
}) {
  if (draft.kind === "bhag") return null;

  if (draft.kind === "subject") {
    if (!functionOptions?.length) return null;
    const typedFunction = draft.placement?.function ?? "";
    const functionNames = functionOptions.map((option) => option.name);
    const chosen = functionOptions.find(
      (option) => normLabel(option.name) === normLabel(typedFunction),
    );
    const typedCategory = draft.placement?.category ?? "";
    const categoryNames = chosen?.categories ?? [];

    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="space-function">Function</Label>
          <LabelComboBox
            id="space-function"
            ariaLabel="Function"
            value={typedFunction}
            options={functionNames.map((name) => ({ value: name, label: name }))}
            container={container}
            inputClassName={FIELD_CLASS}
            placeholder="Choose or name a function"
            onChange={(next) =>
              // A category belongs to one function, so changing the function
              // drops the category rather than carrying a stale one over —
              // the same whether the function was picked or typed.
              onPlace({ function: next, category: undefined })
            }
          />
          <NewNameHint typed={typedFunction} existing={functionNames} what="function" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="space-category">Category</Label>
          <LabelComboBox
            id="space-category"
            ariaLabel="Category"
            value={typedCategory}
            options={categoryNames.map((name) => ({ value: name, label: name }))}
            container={container}
            inputClassName={FIELD_CLASS}
            placeholder="No category"
            onChange={(next) => onPlace({ category: next || undefined })}
          />
          <NewNameHint typed={typedCategory} existing={categoryNames} what="category" />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="space-bhag">BHAG</Label>
        <Select
          id="space-bhag"
          value={draft.placement?.initiative ?? ""}
          onChange={(e) =>
            onPlace({ initiative: e.target.value || undefined, area: undefined })
          }
        >
          {/* Unplaced is a real answer, so it is offered rather than left as
              what happens when nothing is chosen. */}
          <option value="">Not placed yet</option>
          {bhags.map((option) => (
            <option key={option.slug} value={option.slug}>
              {option.name}
            </option>
          ))}
        </Select>
      </div>
      {draft.kind === "project" && (
        <div className="space-y-1">
          <Label htmlFor="space-area">Area</Label>
          <Select
            id="space-area"
            value={draft.placement?.area ?? ""}
            disabled={!draft.placement?.initiative}
            onChange={(e) => onPlace({ area: e.target.value || undefined })}
          >
            <option value="">
              {draft.placement?.initiative ? "No area" : "Choose a BHAG first"}
            </option>
            {areas.map((option) => (
              <option key={option.slug} value={option.slug}>
                {option.name}
              </option>
            ))}
          </Select>
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
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="source-kind">Add a source</Label>
        <div className="flex gap-2">
          <Select
            id="source-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as SourceKind)}
            className="w-36 shrink-0"
          >
            {SOURCE_KINDS.map((entry) => (
              <option key={entry.kind} value={entry.kind}>
                {entry.label}
              </option>
            ))}
          </Select>
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

      <div className="space-y-1 border-t border-border/60 pt-4">
        <button
          type="button"
          role="checkbox"
          aria-checked={draft.scheduleEnabled}
          onClick={() => onChange({ scheduleEnabled: !draft.scheduleEnabled })}
          className="group flex w-full items-center gap-2.5 rounded text-left ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <CheckboxMark checked={draft.scheduleEnabled} />
          <span className="text-sm">Scheduled ingests</span>
          <span className="text-xs text-muted-foreground">
            {describeSchedule(draft.schedule)}
          </span>
        </button>

        {draft.scheduleEnabled && (
          <div className="flex gap-2 pl-6">
            {(["hourly", "daily", "weekly"] as const).map((preset) => (
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
  canInvite,
  onChange,
}: {
  draft: SpaceDraft;
  teams: TeamPickerOption[];
  teamsLoading: boolean;
  /** Whether this reader administers the owning team, which inviting needs. */
  canInvite: boolean;
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
    <div className="space-y-4">
      <div className="space-y-1">
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
            aria-label="Role"
            value={invite.role}
            onChange={(e) =>
              patch(invite.id, { role: e.target.value as Invitation["role"] })
            }
            className="w-32 shrink-0"
          >
            <option value="member">Non-admin</option>
            <option value="admin">Admin</option>
          </Select>
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
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!canInvite}
          onClick={() => add("group")}
        >
          <Plus className="h-3.5 w-3.5" />
          Add group
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!canInvite}
          onClick={() => add("user")}
        >
          <Plus className="h-3.5 w-3.5" />
          Add person
        </Button>
      </div>

      {/* Said before the form rather than after it. Inviting adds someone to
          the owning team, which only that team's admins may do, and a reader
          who learns that at the end has filled in a form to be refused. */}
      <p className="text-xs text-muted-foreground">
        {canInvite
          ? "The first admin becomes this space's data steward, who can write to it and run its ingests. Everyone else is added to the owning team with the role given."
          : "You do not administer this team, so you cannot invite to it. The space will be made and shared with the team; ask one of its admins to add anyone else."}
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

