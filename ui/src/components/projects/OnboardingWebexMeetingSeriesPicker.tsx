"use client";

import Link from "next/link";
import { CalendarDays, Loader2, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { WEBEX_SERIES_LOOKAHEAD_DAYS, occurrenceDiscoveryLabel } from "@/lib/tome/webex-series-discovery-options";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Candidate {
  seriesKey: string;
  title: string;
  hostEmail?: string;
  canAutoIngest: boolean;
  unavailableReason?: string;
  nextOccurrence?: { start: string };
}

interface ApiEnvelope {
  data?: { candidates?: Candidate[]; allowNonHostSeries?: boolean; complete?: boolean; warnings?: string[] };
  error?: string | { message?: string };
  message?: string;
  code?: string;
}

const CONNECTION_REQUIRED = "WEBEX_MEETINGS_CONNECTION_REQUIRED";

function errorMessage(body: ApiEnvelope): string {
  if (typeof body.error === "string") return body.error;
  return body.error?.message || body.message || "Could not find recurring Webex meetings.";
}

export function OnboardingWebexMeetingSeriesPicker({
  selectedSeriesKeys,
  onSelectedSeriesKeysChange,
}: {
  selectedSeriesKeys: string[];
  onSelectedSeriesKeysChange: (keys: string[]) => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [accessWarningCandidate, setAccessWarningCandidate] = useState<Candidate | null>(null);
  const [allowNonHostSeries, setAllowNonHostSeries] = useState(true);
  const [lookaheadDays, setLookaheadDays] = useState(7);
  const [discoveryComplete, setDiscoveryComplete] = useState(true);
  const [discoveryWarnings, setDiscoveryWarnings] = useState<string[]>([]);
  const discoveryRequest = useRef<AbortController | null>(null);
  useEffect(() => () => discoveryRequest.current?.abort(), []);

  const discover = useCallback(async (days = lookaheadDays) => {
    discoveryRequest.current?.abort();
    const controller = new AbortController();
    discoveryRequest.current = controller;
    setLookaheadDays(days);
    setLoading(true);
    setError("");
    setErrorCode("");
    setCandidates([]);
    setDiscoveryWarnings([]);
    try {
      const response = await fetch(`/api/tome/webex-meeting-series?lookaheadDays=${days}`, { cache: "no-store", signal: controller.signal });
      const body = (await response.json().catch(() => ({}))) as ApiEnvelope;
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setErrorCode(body.code ?? "");
        throw new Error(errorMessage(body));
      }
      const nextCandidates = body.data?.candidates ?? [];
      const nextAllowNonHostSeries = body.data?.allowNonHostSeries !== false;
      setCandidates(nextCandidates);
      setAllowNonHostSeries(nextAllowNonHostSeries);
      setDiscoveryComplete(body.data?.complete !== false);
      setDiscoveryWarnings(body.data?.warnings ?? []);
      // A narrower window or partial response must not erase prior selections.
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Could not find recurring Webex meetings.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [lookaheadDays]);

  useEffect(() => {
    void discover();
    // Discover once whenever the picker is opened. Refresh is explicit after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleCandidates = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return candidates;
    return candidates.filter((candidate) =>
      [candidate.title, candidate.hostEmail].some((value) => value?.toLowerCase().includes(query)),
    );
  }, [candidates, searchQuery]);

  const toggle = (candidate: Candidate) => {
    const selected = selectedSeriesKeys.includes(candidate.seriesKey);
    if (!selected && !candidate.canAutoIngest && !allowNonHostSeries) return;
    if (!selected && !candidate.canAutoIngest) {
      setAccessWarningCandidate(candidate);
      return;
    }
    onSelectedSeriesKeysChange(
      selected
        ? selectedSeriesKeys.filter((key) => key !== candidate.seriesKey)
        : [...selectedSeriesKeys, candidate.seriesKey],
    );
  };

  return (
    <div className="mt-4 rounded-lg border border-border/60 bg-background/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <CalendarDays className="h-4 w-4" /> Recurring Webex meetings
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose meeting series to ingest after each occurrence ends and its transcripts are ready.
            These follow the Webex calendar, not the daily or weekly schedule above.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void discover()}
          disabled={loading}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>

      <label className="mt-3 block space-y-1 text-xs text-muted-foreground">
        Upcoming occurrence window (includes the previous 48 hours)
        <Select aria-label="Upcoming occurrence window" value={lookaheadDays} disabled={loading}
          onChange={(event) => void discover(Number(event.target.value))}>
          {WEBEX_SERIES_LOOKAHEAD_DAYS.map((days) => <option key={days} value={days}>Next {days} days</option>)}
        </Select>
      </label>
      {!loading && discoveryWarnings.length > 0 && (
        <div role="status" className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="font-medium">Discovery incomplete — upcoming occurrences may be missing.</p>
          {discoveryWarnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      )}
      {loading ? (
        <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Finding recurring meetings…
        </p>
      ) : error ? (
        <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
          <p className="flex items-start gap-1.5">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
          {errorCode === CONNECTION_REQUIRED && (
            <Link
              href="/credentials#connections"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block font-medium text-primary underline"
            >
              Connect Webex (Meetings)
            </Link>
          )}
        </div>
      ) : candidates.length === 0 ? (
        <p className="py-6 text-xs text-muted-foreground">{discoveryComplete ? "No recurring Webex meetings were found. Try a longer window for less frequent calendar-only series." : "No series returned from the completed lookups. Refresh to try again."}</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label="Search recurring Webex meetings"
              placeholder="Search by meeting title or host"
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {visibleCandidates.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No meetings match “{searchQuery.trim()}”.
            </p>
          ) : (
            <div className="max-h-64 divide-y overflow-y-auto rounded-lg border border-border/60">
              {visibleCandidates.map((candidate) => {
                const selected = selectedSeriesKeys.includes(candidate.seriesKey);
                return (
                  <label
                    key={candidate.seriesKey}
                    className={cn(
                      "flex items-center gap-3 px-3 py-3",
                      candidate.canAutoIngest
                        ? "cursor-pointer hover:bg-accent/30"
                        : allowNonHostSeries
                          ? "cursor-pointer bg-amber-50/70 hover:bg-amber-100/70 dark:bg-amber-950/20 dark:hover:bg-amber-950/30"
                          : "cursor-not-allowed bg-muted/20 opacity-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={!candidate.canAutoIngest && !allowNonHostSeries}
                      onChange={() => toggle(candidate)}
                      aria-label={`Select ${candidate.title}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{candidate.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {occurrenceDiscoveryLabel(candidate.nextOccurrence?.start, lookaheadDays, discoveryComplete)}
                        {candidate.hostEmail ? ` · Host: ${candidate.hostEmail}` : ""}
                      </span>
                      {!candidate.canAutoIngest && (
                        <span
                          className={cn(
                            "block text-[11px]",
                            allowNonHostSeries
                              ? "text-amber-800 dark:text-amber-200"
                              : "text-muted-foreground",
                          )}
                        >
                          {allowNonHostSeries
                            ? "Not host · recording and transcript access required"
                            : "Non-hosted meeting series are disabled by your administrator"}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        {selectedSeriesKeys.length} meeting series selected
      </p>

      <Dialog
        open={Boolean(accessWarningCandidate)}
        onOpenChange={(open) => {
          if (!open) setAccessWarningCandidate(null);
        }}
      >
        <DialogContent className="border-amber-400 sm:max-w-lg dark:border-amber-700">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-900 dark:text-amber-100">
              <TriangleAlert className="h-5 w-5 text-amber-600" /> Recording access required
            </DialogTitle>
            <DialogDescription>
              You are not the host of “{accessWarningCandidate?.title}”.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            Auto-ingest will work only for occurrences whose recording and transcript Webex makes
            available to your account—for example, because you are a cohost or the recording was
            shared with you. A calendar invitation or attendance alone does not guarantee access.
            Unavailable occurrences will retry and then be skipped.
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAccessWarningCandidate(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-amber-600 text-white hover:bg-amber-700"
              disabled={!accessWarningCandidate}
              onClick={() => {
                const candidate = accessWarningCandidate;
                setAccessWarningCandidate(null);
                if (candidate && !selectedSeriesKeys.includes(candidate.seriesKey)) {
                  onSelectedSeriesKeysChange([...selectedSeriesKeys, candidate.seriesKey]);
                }
              }}
            >
              Add with warning
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
