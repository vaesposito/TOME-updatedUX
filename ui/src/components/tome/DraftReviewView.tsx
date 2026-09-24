"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ArtifactEvaluation } from "@/types/tome-evaluation";

/**
 * Per-page diff of what one ingest run changed. For a run awaiting review,
 * this is the reviewer's decision surface (Approve/Reject vs. what's live).
 * For a terminal run, it's read-only — the same diff, browsed after the
 * fact, since the log tells you what the agent DID but not what it wrote.
 */

interface DraftPage {
  path: string;
  oldBody: string;
  newBody: string;
  isNewPage: boolean;
  requiresDecision: boolean;
  decision: "accept" | "reject" | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export function DraftReviewView({
  slug,
  runId,
  canEdit,
  onResolved,
}: {
  slug: string;
  runId: string;
  canEdit: boolean;
  onResolved?: () => void;
}) {
  const [pages, setPages] = useState<DraftPage[] | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState<"none" | "stable_only" | "all">("stable_only");
  const [finalizingAction, setFinalizingAction] = useState<"accept" | "reject" | "files" | null>(null);
  const finalizing = finalizingAction !== null;
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Approve/Reject only make sense while the run is actually awaiting review —
  // fetched here so callers can just point this at any run id (a pending
  // draft or one long since terminal) without knowing its status upfront.
  const [reviewable, setReviewable] = useState(false);
  const [qualityEvaluation, setQualityEvaluation] = useState<ArtifactEvaluation | null>(null);
  const [qualityPolicy, setQualityPolicy] = useState<{
    mode: "off" | "observe" | "enforce";
    version: number | null;
    allow_steward_override: boolean;
  } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tome/projects/${slug}/ingests/${runId}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) {
          setReviewable(j?.data?.status === "awaiting_review");
          setQualityEvaluation(j?.data?.quality_evaluation ?? null);
          setQualityPolicy(j?.data?.quality_policy ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setReviewable(false);
      });
    fetch(`/api/tome/projects/${slug}/ingests/${runId}/review`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body?.error || `Loading changed files failed (${response.status})`);
        }
        return body;
      })
      .then((j) => {
        if (cancelled) return;
        setReviewable(j?.data?.status === "awaiting_review");
        if (["none", "stable_only", "all"].includes(j?.data?.reviewMode)) {
          setReviewMode(j.data.reviewMode);
        }
        const loaded = (j?.data?.pages ?? []) as DraftPage[];
        setPages(loaded);
        setSelectedPath(loaded.find((page) => page.requiresDecision && page.decision === null)?.path
          ?? loaded[0]?.path
          ?? null);
      })
      .catch((cause) => {
        if (!cancelled) {
          setPages([]);
          setError(String((cause as Error)?.message ?? cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, runId]);

  const decide = async (path: string, decision: "accept" | "reject") => {
    setSavingPath(path);
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/ingests/${runId}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, decision }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Saving file review failed (${res.status})`);
      }
      setPages((current) => current?.map((page) => (
        page.path === path ? { ...page, decision } : page
      )) ?? current);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSavingPath(null);
    }
  };

  const finalize = async (decision?: "accept" | "reject") => {
    setFinalizingAction(decision ?? "files");
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/ingests/${runId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(decision ? { decision } : {}),
          ...(overrideReason.trim() ? { override_reason: overrideReason.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Finalizing review failed (${res.status})`);
      }
      if (decision) {
        setPages((current) => current?.map((page) => (
          page.requiresDecision ? { ...page, decision } : page
        )) ?? current);
      }
      setReviewable(false);
      onResolved?.();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setFinalizingAction(null);
    }
  };

  const selected = pages?.find((p) => p.path === selectedPath) ?? null;
  const failedBlockingRubrics = qualityEvaluation?.rubrics.filter(
    (rubric) => rubric.enabled && rubric.blocking && rubric.passed !== true,
  ) ?? [];
  const gateBlocked = qualityPolicy?.mode === "enforce" && (
    !qualityEvaluation
    || qualityEvaluation.status === "error"
    || failedBlockingRubrics.length > 0
    || qualityEvaluation.blocking_findings.length > 0
  );
  const overrideReady = qualityPolicy?.allow_steward_override && overrideReason.trim().length >= 10;
  const decisionPages = pages?.filter((page) => page.requiresDecision) ?? [];
  const reviewedCount = decisionPages.filter((page) => page.decision !== null).length;
  const acceptedCount = decisionPages.filter((page) => page.decision === "accept").length;
  const pendingCount = decisionPages.length - reviewedCount;
  const publishedCount = pages?.filter((page) => !page.requiresDecision).length ?? 0;
  const allFilesReviewed = pages !== null && decisionPages.length > 0 && pendingCount === 0;
  const qualityBlocksAccept = gateBlocked && !overrideReady;
  const qualityBlocksDone = acceptedCount > 0 && qualityBlocksAccept;
  const bulkDisabled = finalizing || savingPath !== null || pages === null || decisionPages.length === 0;
  const finishMessage = pages === null
    ? "Loading the changed files…"
    : pendingCount > 0
      ? `Choose Accept or Reject for ${pendingCount} remaining file${pendingCount === 1 ? "" : "s"}, or use Accept all / Reject all to finish now.`
      : qualityBlocksDone
        ? "Resolve the quality gate below before finishing."
        : decisionPages.length === 0
          ? "This ingest has no files awaiting a decision."
          : "All required decisions are complete. Finish to publish accepted files.";
  const reviewModeLabel = reviewMode === "all"
    ? "Review everything"
    : reviewMode === "none"
      ? "Auto-accept all"
      : "Stable pages only";

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-background px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-base font-semibold">
              {reviewable ? "Review ingest changes" : "Changed files"}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {pages === null
                ? "Loading changed files…"
                : reviewable
                  ? `${pages.length} changed · ${reviewedCount} of ${decisionPages.length} required decisions complete`
                  : `${pages.length} file${pages.length === 1 ? "" : "s"} changed`}
            </p>
          </div>
          {reviewable && canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void finalize("accept")}
                disabled={bulkDisabled || qualityBlocksAccept}
                className="flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                title={qualityBlocksAccept
                  ? "Resolve the quality gate below before accepting all files."
                  : "Accept every draft file and finish this ingest review immediately, replacing individual choices."}
              >
                {finalizingAction === "accept" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Accept all
              </button>
              <button
                type="button"
                onClick={() => void finalize("reject")}
                disabled={bulkDisabled}
                className="flex min-h-10 items-center gap-2 rounded-md border border-destructive/40 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                title="Reject every draft file and finish this ingest review immediately, replacing individual choices."
              >
                {finalizingAction === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                Reject all
              </button>
              <button
                type="button"
                onClick={() => void finalize()}
                disabled={finalizing || savingPath !== null || !allFilesReviewed || qualityBlocksDone}
                className="flex min-h-10 items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                title={finishMessage}
              >
                {finalizingAction === "files" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Finish review
              </button>
            </div>
          )}
          {reviewable && !canEdit && (
            <p className="text-xs text-muted-foreground">
              Only the data steward or a Tome admin can review this draft.
            </p>
          )}
        </div>
        {reviewable && canEdit && (
          <div className={cn(
            "mt-3 rounded-md border px-3 py-2 text-sm",
            pendingCount > 0
              ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
              : qualityBlocksDone
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100",
          )}>
            <span className="font-medium">{finishMessage}</span>
            {publishedCount > 0 && (
              <span className="ml-1">
                {publishedCount} other changed file{publishedCount === 1 ? " was" : "s were"} already published by the “{reviewModeLabel}” policy and remain visible below. Accept all / Reject all only affects draft files; published files stay unchanged.{" "}
                <a
                  href={`/projects/${slug}/tome/settings?tab=review`}
                  className="font-semibold underline underline-offset-2"
                >
                  Require review for every file
                </a>
              </span>
            )}
            <p className="mt-1">Accept all / Reject all finishes immediately and replaces any individual file choices.</p>
          </div>
        )}
      </div>
      {error && (
        <p className="border-b bg-destructive/10 px-5 py-2 text-sm text-destructive">{error}</p>
      )}

      {qualityPolicy && qualityPolicy.mode !== "off" && (
        <div className="space-y-2 border-b px-5 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Grounded quality</span>
            <span className={qualityEvaluation?.status === "passed" ? "text-emerald-600" : "text-destructive"}>
              {qualityEvaluation?.status ?? "not evaluated"}
            </span>
            <span className="text-muted-foreground">
              {qualityPolicy.mode} policy · version {qualityPolicy.version ?? "—"}
            </span>
          </div>
          {qualityEvaluation && (
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {qualityEvaluation.rubrics.filter((rubric) => rubric.enabled).map((rubric) => (
                <div key={rubric.id} className="flex justify-between gap-3 rounded bg-muted px-2 py-1">
                  <span>{rubric.id.replaceAll("_", " ")}</span>
                  <span>{rubric.passed === null ? "telemetry" : rubric.passed ? "pass" : "fail"}</span>
                </div>
              ))}
            </div>
          )}
          {failedBlockingRubrics.flatMap((rubric) => rubric.findings).map((finding) => (
            <p key={finding} className="text-destructive">{finding}</p>
          ))}
          {qualityEvaluation && qualityEvaluation.claims.length > 0 && (
            <details>
              <summary className="cursor-pointer font-medium">Claim findings ({qualityEvaluation.claims.length})</summary>
              <div className="mt-2 max-h-52 space-y-2 overflow-auto">
                {qualityEvaluation.claims.map((claim) => (
                  <div key={claim.id} className="rounded border p-2">
                    <p className="font-medium">{claim.classification} · {claim.page}{claim.section ? ` · ${claim.section}` : ""}</p>
                    <p>&ldquo;{claim.exact_text}&rdquo;</p>
                    <p className="text-muted-foreground">{claim.reason} · confidence {claim.confidence.toFixed(2)}{claim.abstained ? " · abstained" : ""}</p>
                    {claim.citations.filter((citation) => /^https?:\/\//.test(citation)).map((citation) => (
                      <a key={citation} href={citation} target="_blank" rel="noreferrer" className="block truncate text-primary underline">{citation}</a>
                    ))}
                    {claim.evidence.map((evidence) => (
                      <p key={`${claim.id}-${evidence.evidence_item_id}`} className="truncate font-mono text-[10px] text-muted-foreground" title={evidence.canonical_uri}>
                        Evidence: {evidence.canonical_uri} · sha256:{evidence.content_hash}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          )}
          {reviewable && gateBlocked && decisionPages.length > 0 && qualityPolicy.allow_steward_override && canEdit && (
            <label className="block font-medium">
              Required override reason
              <textarea
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Explain why this failed evaluation is safe to promote…"
                className="mt-1 min-h-16 w-full rounded-md border bg-background p-2 font-normal"
              />
            </label>
          )}
          {reviewable && gateBlocked && decisionPages.length > 0 && !qualityPolicy.allow_steward_override && (
            <p className="text-destructive">Promotion is blocked by the enforced quality policy.</p>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 shrink-0 border-r bg-background">
          <div className="border-b px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Files changed ({pages?.length ?? 0})
            </p>
          </div>
          <ScrollArea className="h-full">
            {pages === null ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : pages.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No pages changed.</p>
            ) : (
              <ul>
                {pages.map((p) => (
                  <li key={p.path}>
                    <button
                      type="button"
                      onClick={() => setSelectedPath(p.path)}
                      className={cn(
                        "flex w-full items-start gap-2 border-b px-4 py-3 text-left text-sm transition-colors hover:bg-muted",
                        selectedPath === p.path && "bg-muted",
                      )}
                      title={p.path}
                    >
                      {p.decision === "accept" ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-label="Accepted" />
                      ) : p.decision === "reject" ? (
                        <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-label="Rejected" />
                      ) : p.requiresDecision ? (
                        <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Pending" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-sky-600" aria-label="Already published" />
                      )}
                      <span className="min-w-0 flex-1 break-all leading-5">{p.path}</span>
                      <span className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        p.decision === "accept"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : p.decision === "reject"
                            ? "bg-destructive/10 text-destructive"
                            : p.requiresDecision
                              ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                              : "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
                      )}>
                        {p.decision === "accept"
                          ? "Accepted"
                          : p.decision === "reject"
                            ? "Rejected"
                            : p.requiresDecision
                              ? "Pending"
                              : "Published"}
                      </span>
                      {p.isNewPage && (
                        <span className="sr-only">New file</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-muted/30">
          {!selected ? (
            <p className="p-6 text-sm text-muted-foreground">Pick a page on the left.</p>
          ) : (
            <>
              {reviewable && canEdit && selected.requiresDecision && (
                <div className="flex items-center justify-between gap-4 border-b bg-background px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" title={selected.path}>
                      {selected.path}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selected.decision === "accept"
                        ? "Accepted — this file will be published when you finish the review."
                        : selected.decision === "reject"
                          ? "Rejected — this file will be discarded when you finish the review."
                          : "Decision required: accept or reject this file."}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void decide(selected.path, "reject")}
                      disabled={savingPath !== null || finalizing}
                      className={cn(
                        "flex min-h-10 min-w-32 items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50",
                        selected.decision === "reject"
                          ? "border-destructive bg-destructive text-destructive-foreground"
                          : "border-destructive/50 text-destructive hover:bg-destructive/10",
                      )}
                    >
                      {savingPath === selected.path ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                      Reject file
                    </button>
                    <button
                      type="button"
                      onClick={() => void decide(selected.path, "accept")}
                      disabled={savingPath !== null || finalizing}
                      className={cn(
                        "flex min-h-10 min-w-32 items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50",
                        selected.decision === "accept"
                          ? "border-emerald-700 bg-emerald-700 text-white"
                          : "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700",
                      )}
                    >
                      {savingPath === selected.path ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Accept file
                    </button>
                  </div>
                </div>
              )}
              {reviewable && !selected.requiresDecision && (
                <div className="border-b border-sky-200 bg-sky-50 px-5 py-3 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
                  <span className="font-medium">Already published.</span>{" "}
                  This file did not require approval under the “{reviewModeLabel}” review policy.
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-auto">
                <ReactDiffViewer
                  oldValue={selected.oldBody}
                  newValue={selected.newBody}
                  splitView
                  compareMethod={DiffMethod.WORDS}
                  useDarkTheme={dark}
                  leftTitle={selected.isNewPage ? "(new file)" : "live"}
                  rightTitle={selected.requiresDecision ? "draft" : "ingest change"}
                  styles={{ diffContainer: { minWidth: 0 } }}
                />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
