"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SourcesEditor } from "@/components/projects/source-pickers/SourcesEditor";
import { useProjectSourceKinds } from "@/components/projects/source-pickers/useProjectSourceKinds";
import {
  myAgentConsentSelection,
  sameMyAgentConsentSelection,
  saveMyAgentConsent,
} from "@/lib/projects/myagent-consent-client";
import { normalizeMyAgentConnectors } from "@/lib/projects/myagent-source";
import { useMyAgentEnabled } from "@/hooks/use-myagent-enabled";
import { isSynthesizedType, type ProjectSources, type ProjectType } from "@/types/projects";

/**
 * The sources attached to a project — the GitHub repos / Confluence space / etc.
 * the agent reads (and that scope its read-only MCP allowlist). Which connectors
 * appear is driven by the onboarding YAML (`useProjectSourceKinds`), and the
 * picker UX is the shared `SourcesEditor` used in project creation too. Editing
 * here PATCHes the CAIPE project's `sources`, so the next ingest/chat picks them
 * up.
 */

const EMPTY: ProjectSources = {
  repos: [],
  confluence_url: "",
  webex_rooms: [],
  myagent_connectors: [],
  myagent_enabled: false,
};

export function ProjectAssets({
  slug,
  canEdit,
}: {
  slug: string;
  canEdit: boolean;
}) {
  const { kinds, loading: kindsLoading } = useProjectSourceKinds();
  const myAgentEnabled = useMyAgentEnabled() === true;
  const [sources, setSources] = useState<ProjectSources | null>(null);
  const [projectType, setProjectType] = useState<ProjectType | undefined>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProjectSources>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${slug}`);
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const json = await res.json();
      setProjectType(json?.data?.project?.type);
      const s = json?.data?.project?.sources ?? {};
      setSources({
        repos: Array.isArray(s.repos) ? s.repos : [],
        confluence_url: typeof s.confluence_url === "string" ? s.confluence_url : "",
        confluence_page_scopes: Array.isArray(s.confluence_page_scopes)
          ? s.confluence_page_scopes
          : undefined,
        confluence_page_scope:
          s.confluence_page_scope &&
          typeof s.confluence_page_scope === "object"
            ? s.confluence_page_scope
            : undefined,
        webex_rooms: Array.isArray(s.webex_rooms) ? s.webex_rooms : [],
        webex_credential_mode:
          s.webex_credential_mode === "managed" ? "managed" : "personal",
        webex_credential_provider:
          typeof s.webex_credential_provider === "string"
            ? s.webex_credential_provider
            : "webex",
        myagent_connectors: normalizeMyAgentConnectors(s.myagent_connectors),
        myagent_enabled: s.myagent_enabled === true,
        myagent_consent_revision:
          typeof s.myagent_consent_revision === "string" ? s.myagent_consent_revision : null,
      });
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = () => {
    if (!sources) return;
    setDraft(sources);
    setError(null);
    setEditing(true);
  };

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const repos = (draft.repos ?? []).map((r) => r.trim()).filter(Boolean);
      const myAgentConsentChanged =
        !isSynthesizedType(projectType) &&
        !sameMyAgentConsentSelection(
          myAgentConsentSelection(sources ?? undefined),
          myAgentConsentSelection(draft),
        );
      const res = await fetch(`/api/projects/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sources: {
            repos,
            confluence_url: (draft.confluence_url ?? "").trim(),
            confluence_page_scopes: draft.confluence_page_scopes ?? [],
            confluence_page_scope: draft.confluence_page_scope ?? null,
            webex_rooms: draft.webex_rooms ?? [],
            webex_credential_mode:
              draft.webex_credential_mode ?? "personal",
            webex_credential_provider:
              draft.webex_credential_provider ?? "webex",
          },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `save failed (${res.status})`);
      }
      if (myAgentConsentChanged) {
        await saveMyAgentConsent(slug, draft);
      }
      setEditing(false);
      await load();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }, [slug, draft, load, projectType, sources]);

  const visibleKinds = kinds.filter(
    (kind) => kind !== "myagent" || (!isSynthesizedType(projectType) && myAgentEnabled),
  );
  const hasSources = visibleKinds.length > 0;

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Project sources</h3>
        {canEdit && hasSources && !editing && sources !== null && (
          <Button variant="ghost" size="sm" onClick={startEdit} title="Edit sources">
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        )}
      </div>

      {sources === null || kindsLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : editing ? (
        <div className="space-y-4">
          <SourcesEditor kinds={visibleKinds} value={draft} onChange={setDraft} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <SourcesEditor kinds={visibleKinds} value={sources} onChange={() => {}} readOnly />
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}
