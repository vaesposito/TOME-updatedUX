import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";

import { ProviderLogo } from "@/components/credentials/provider-logo";
import type { PreflightSourceResult } from "@/lib/tome/preflight";
import type { WebexCredentialMode, WebexRoomCheck } from "@/types/projects";
import { WebexRoomRunsAs } from "./WebexRoomRunsAs";

interface SpaceItem {
  room_id?: string;
  label: string;
  webexMode?: WebexCredentialMode;
}

type CheckedSpace = SpaceItem & {
  mode: WebexCredentialMode;
  check?: WebexRoomCheck;
};

function unavailableReason({ check, mode }: CheckedSpace): string {
  if (check?.no_token) {
    return mode === "managed"
      ? "The managed Webex account is unavailable. Contact an administrator."
      : "Connect your Webex account to access this space.";
  }
  if (check?.access === "inaccessible") {
    return mode === "managed"
      ? "The managed Webex account no longer has access, or this space no longer exists. Contact an administrator."
      : "You don't have access to this space, or it no longer exists.";
  }
  return mode === "managed"
    ? "Could not verify the managed account's access. Refresh and try again; if this continues, contact an administrator."
    : "Could not verify access to this space. Refresh and try again.";
}

function SpaceList({ spaces, showReason = false }: { spaces: CheckedSpace[]; showReason?: boolean }) {
  return (
    <ul className="mt-1 space-y-2">
      {spaces.map((space) => (
        <li key={space.room_id ?? space.label} className="flex min-w-0 items-start gap-1.5 text-xs">
          <span aria-hidden="true" className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
          <div className="min-w-0">
            <span className="break-words text-foreground/90">{space.label}</span>
            {" · "}<WebexRoomRunsAs runAs={space.check?.run_as} mode={space.mode} />
            {showReason && <p className="mt-0.5 break-words text-amber-700 dark:text-amber-400">{unavailableReason(space)}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Describe per-room preflight without treating one missing personal connection
 * as a failure of the managed account. This does not change execution policy.
 */
export function WebexIngestSources({ items, preflight }: {
  items: SpaceItem[];
  preflight?: PreflightSourceResult;
}) {
  const checks = new Map(preflight?.rooms?.map((room) => [room.room_id, room]));
  const spaces: CheckedSpace[] = items.map((item) => {
    const check = item.room_id ? checks.get(item.room_id) : undefined;
    return { ...item, check, mode: check?.mode ?? item.webexMode ?? "personal" };
  });
  const ready = spaces.filter((space) => space.check?.available);
  const blocked = spaces.filter((space) => space.mode === "managed" && space.check && !space.check.available);
  const skipped = spaces.filter((space) => space.mode === "personal" && !space.check?.available
    && (space.check?.no_token || space.check?.access === "inaccessible"));
  const unknown = spaces.filter((space) => !ready.includes(space) && !blocked.includes(space) && !skipped.includes(space));
  const allReady = ready.length === spaces.length;

  return (
    <li className="flex items-start gap-3 py-3">
      {allReady
        ? <CheckCircle2 aria-label="All Webex spaces accessible" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        : <XCircle aria-label="Some Webex spaces need attention" className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <ProviderLogo provider="webex" className="h-3.5 w-3.5 shrink-0 object-contain" />
          Webex
        </p>
        {blocked.length > 0 && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            Ingest cannot start while the managed-account spaces below are unavailable.
          </p>
        )}
        {ready.length > 0 && (
          <section aria-label={blocked.length ? "Access confirmed" : "Will be ingested"} className="mt-2">
            <h4 className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {blocked.length ? "Access confirmed" : "Will be ingested"}
            </h4>
            {!blocked.length && skipped.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                You can still run ingest for these spaces. The unavailable spaces below won&apos;t contribute data.
              </p>
            )}
            {ready.some((space) => space.mode === "managed") && (
              <p className="mt-1 text-xs text-muted-foreground">
                Managed-account spaces don&apos;t require your own Webex connection or membership.
              </p>
            )}
            <SpaceList spaces={ready} />
          </section>
        )}
        {skipped.length > 0 && (
          <section aria-label="Won't be ingested" className="mt-3">
            <h4 className="text-xs font-medium text-amber-700 dark:text-amber-400">Won&apos;t be ingested</h4>
            <SpaceList spaces={skipped} showReason />
          </section>
        )}
        {blocked.length > 0 && (
          <section aria-label="Ingest blocked" className="mt-3">
            <h4 className="text-xs font-medium text-amber-700 dark:text-amber-400">Ingest blocked</h4>
            <SpaceList spaces={blocked} showReason />
          </section>
        )}
        {unknown.length > 0 && (
          <section aria-label="Access not verified" className="mt-3">
            <h4 className="text-xs font-medium text-amber-700 dark:text-amber-400">Access not verified</h4>
            <p className="mt-1 text-xs text-muted-foreground">These spaces are not confirmed ready; ingestion will check access again.</p>
            <SpaceList spaces={unknown} showReason />
          </section>
        )}
        {skipped.some((space) => space.check?.no_token) && (
          <Link href="/credentials" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-primary hover:underline">
            Connect Webex in Connections →
          </Link>
        )}
      </div>
    </li>
  );
}
