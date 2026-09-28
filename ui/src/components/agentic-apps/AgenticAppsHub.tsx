"use client";

import {
  ArrowUpRight,
  CloudSun,
  DollarSign,
  Info,
  LayoutGrid,
  LoaderCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AgenticAppSecurityDialog } from "@/components/agentic-apps/AgenticAppSecurityDialog";
import { apiClient } from "@/lib/api-client";
import type { PublicAgenticApp } from "@/types/agentic-app";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; apps: PublicAgenticApp[] }
  | { status: "error"; message: string };

export function AgenticAppsHub(): React.ReactElement {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [favoriteAppIds, setFavoriteAppIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/agentic-apps", { cache: "no-store" }).then(async (response) => {
        if (response.status === 401) {
          window.location.assign(
            `/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`,
          );
          return null;
        }
        if (!response.ok) {
          throw new Error(`Apps catalog returned HTTP ${response.status}`);
        }
        return response.json() as Promise<{ items: PublicAgenticApp[] }>;
      }),
      apiClient.getSettings().catch(() => null),
    ])
      .then(([payload, settings]) => {
        if (cancelled) return;
        if (payload) setState({ status: "ready", apps: payload.items });
        setFavoriteAppIds(
          normalizeFavoriteAppIds(settings?.preferences.favorite_agentic_apps),
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load Apps",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleApps = useMemo(() => {
    if (state.status !== "ready") return [];
    const terms = normalizeSearch(query).split(" ").filter(Boolean);
    if (terms.length === 0) return state.apps;
    return state.apps.filter((app) => {
      const searchable = normalizeSearch(
        [
          app.appId,
          app.displayName,
          app.description,
          app.createdBy,
          ...app.categories,
          ...app.capabilities,
          ...app.requestedScopes,
        ].join(" "),
      );
      return terms.every((term) => searchable.includes(term));
    });
  }, [query, state]);

  async function toggleFavorite(appId: string): Promise<void> {
    const previous = favoriteAppIds;
    const next = previous.includes(appId)
      ? previous.filter((id) => id !== appId)
      : [...previous, appId];
    setFavoriteAppIds(next);
    try {
      const updated = await apiClient.updatePreferences({
        favorite_agentic_apps: next,
      });
      setFavoriteAppIds(
        normalizeFavoriteAppIds(updated.preferences.favorite_agentic_apps),
      );
    } catch {
      setFavoriteAppIds(previous);
    }
  }

  return (
    <main className="flex-1 overflow-y-auto bg-background px-5 py-5 text-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="relative overflow-hidden rounded-[1.25rem] border border-border bg-card/60 px-5 py-4 shadow-lg backdrop-blur">
          <div className="absolute -right-20 -top-28 h-52 w-52 rounded-full bg-primary/15 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <span className="rounded-xl bg-primary/10 p-2 text-primary">
              <LayoutGrid className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Apps</h1>
              <p className="mt-1 max-w-4xl text-sm leading-5 text-muted-foreground">
                Discover trusted apps with platform-managed sign-in, navigation,
                authorization, credentials, and policy.
              </p>
            </div>
          </div>
        </header>

        {state.status === "loading" ? (
          <div className="flex min-h-64 items-center justify-center rounded-xl border border-border bg-card">
            <LoaderCircle
              className="h-6 w-6 animate-spin text-muted-foreground"
              aria-label="Loading Apps"
            />
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6">
            <h2 className="font-semibold">Could not load Apps</h2>
            <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
          </div>
        ) : null}

        {state.status === "ready" ? (
          state.apps.length === 0 ? (
            <section className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
              <h2 className="text-lg font-semibold">No Apps are configured</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                An operator can add an app through the deployment-owned catalog.
              </p>
            </section>
          ) : (
            <>
              <section
                aria-label="Search Apps"
                className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
              >
                <label className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <input
                    className="h-11 w-full appearance-none rounded-xl border border-border bg-background py-2 pl-10 pr-11 text-sm text-foreground outline-none transition placeholder:text-muted-foreground hover:border-primary/40 focus:border-primary/60 focus:ring-2 focus:ring-primary/15 [&::-webkit-search-cancel-button]:appearance-none"
                    type="search"
                    placeholder="Search by app, capability, category, or scope"
                    aria-label="Search apps"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="Clear search"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                </label>
                <p
                  className="shrink-0 px-1 text-xs font-medium text-muted-foreground"
                  aria-live="polite"
                >
                  {query.trim()
                    ? `${visibleApps.length} of ${state.apps.length} apps`
                    : `${state.apps.length} ${state.apps.length === 1 ? "app" : "apps"}`}
                </p>
              </section>

              {visibleApps.length === 0 ? (
                <section className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center text-muted-foreground">
                  No Apps match &ldquo;{query.trim()}&rdquo;.
                </section>
              ) : (
                <section
                  className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                  aria-label="Available Apps"
                >
                  {visibleApps.map((app) => (
                    <AppCard
                      key={app.appId}
                      app={app}
                      isFavorite={favoriteAppIds.includes(app.appId)}
                      onToggleFavorite={() => toggleFavorite(app.appId)}
                    />
                  ))}
                </section>
              )}
            </>
          )
        ) : null}
      </div>
    </main>
  );
}

function AppCard({
  app,
  isFavorite,
  onToggleFavorite,
}: {
  app: PublicAgenticApp;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}): React.ReactElement {
  const presentation = getAppPresentation(app);
  const Icon = presentation.Icon;
  const blockedLabel = formatBlockedReasons(app.blockedReasons);

  return (
    <article className="group relative flex min-h-64 flex-col overflow-hidden rounded-[1.35rem] border border-border bg-card p-4 shadow-md transition duration-200 hover:-translate-y-1 hover:border-primary/30 hover:bg-accent/40">
      <div
        className={`absolute -right-20 -top-24 h-48 w-48 rounded-full bg-gradient-to-br ${presentation.glow} opacity-80 blur-3xl transition group-hover:opacity-100`}
      />
      <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3">
        <div
          aria-label={`${app.displayName} app icon`}
          className={`flex h-11 w-11 items-center justify-center rounded-2xl border border-border/60 bg-gradient-to-br ${presentation.gradient} text-white shadow-md`}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            type="button"
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition ${isFavorite ? "border-amber-200/50 bg-amber-300/20 text-amber-100" : "border-border bg-muted/40 text-muted-foreground hover:border-amber-400/40 hover:bg-amber-400/10 hover:text-amber-500"}`}
            onClick={onToggleFavorite}
            aria-label={
              isFavorite
                ? `Unpin ${app.displayName} from home`
                : `Pin ${app.displayName} to home`
            }
            title={isFavorite ? "Pinned to home" : "Pin to home"}
          >
            <Star
              className="h-3.5 w-3.5"
              fill={isFavorite ? "currentColor" : "none"}
              aria-hidden
            />
          </button>
          <RuntimeInfoTooltip app={app} />
          {app.sharingEnabled ? (
            <AgenticAppSecurityDialog
              appId={app.appId}
              displayName={app.displayName}
              createdBy={app.createdBy}
              requestedScopes={app.requestedScopes}
              initialVisibility={app.visibility}
              initialSharedWithTeams={app.sharedWithTeams}
              canManage={app.canManage}
            />
          ) : null}
          {app.canLaunch ? (
            <a
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted/40 text-primary transition hover:border-primary/40 hover:bg-primary/15"
              href={app.href}
              aria-label={`Open ${app.displayName}`}
              title={`Open ${app.displayName}`}
            >
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : (
            <span
              className="inline-flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-full border border-amber-200/20 bg-amber-300/10 text-amber-100"
              aria-label={`${app.displayName} launch blocked`}
              title={`Launch blocked: ${blockedLabel}`}
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            </span>
          )}
        </div>
      </div>
      <div className="pointer-events-none relative z-10 mt-4">
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${presentation.badge}`}
        >
          {presentation.category}
        </span>
      </div>
      {app.canLaunch ? (
        <a
          href={app.href}
          aria-label={`Launch ${app.displayName}`}
          className="appcard-stretched-link absolute inset-0 z-[5] cursor-pointer rounded-[1.35rem] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <span className="sr-only">Launch {app.displayName}</span>
        </a>
      ) : null}
      <h2 className="pointer-events-none relative z-10 mt-3 line-clamp-1 text-lg font-semibold text-foreground">
        {app.displayName}
      </h2>
      <p className="pointer-events-none relative z-10 mt-2 line-clamp-3 flex-1 text-xs leading-5 text-muted-foreground">
        {app.description}
      </p>
      <p className="pointer-events-none relative z-10 mt-3 text-[11px] text-muted-foreground">
        Created by {app.createdBy}
      </p>
      {!app.canLaunch ? (
        <div className="relative z-10 mt-3 rounded-2xl border border-amber-200/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
          Launch blocked: {blockedLabel}
        </div>
      ) : null}
    </article>
  );
}

function getAppPresentation(app: PublicAgenticApp) {
  if (app.appId === "weather") {
    return {
      Icon: CloudSun,
      category: "Weather",
      gradient: "from-sky-300 via-cyan-300 to-blue-500",
      glow: "from-sky-300/40 to-cyan-500/10",
      badge: "bg-sky-500 text-white",
    };
  }
  if (app.appId === "finops" || app.appId === "litellm") {
    return {
      Icon: DollarSign,
      category: app.categories[0] ?? "FinOps",
      gradient: "from-emerald-300 via-cyan-300 to-teal-500",
      glow: "from-emerald-300/40 to-cyan-500/10",
      badge: "bg-emerald-500 text-white",
    };
  }
  return {
    Icon: Sparkles,
    category: app.categories[0] ?? "Agentic app",
    gradient: "from-violet-300 via-cyan-300 to-indigo-500",
    glow: "from-violet-300/35 to-cyan-500/10",
    badge: "bg-violet-500 text-white",
  };
}

function formatBlockedReasons(reasons: string[]): string {
  return reasons.length
    ? reasons.join(", ").replaceAll("_", " ")
    : "policy denied";
}

function RuntimeInfoTooltip({
  app,
}: {
  app: PublicAgenticApp;
}): React.ReactElement {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setCoords({
      top: rect.bottom + 8,
      left: Math.min(window.innerWidth - 300, Math.max(12, rect.right - 288)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
        aria-label={`Runtime details for ${app.displayName}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && coords && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              className="fixed z-[60] w-72 rounded-2xl border border-border bg-popover p-4 text-left text-xs leading-5 text-popover-foreground shadow-lg backdrop-blur"
              style={{ top: coords.top, left: coords.left }}
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                App runtime
              </p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {app.runtimeKind === "in-process" ? "In-process" : "Separate process"}
              </p>
              <p className="mt-1 text-muted-foreground">
                This app runs independently and is securely connected through the
                platform gateway.
              </p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function normalizeFavoriteAppIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      ),
    ),
  ];
}

function normalizeSearch(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[-_:/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
