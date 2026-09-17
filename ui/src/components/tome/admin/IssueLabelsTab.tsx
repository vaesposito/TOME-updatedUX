"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RotateCcw, Save, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  DEFAULT_TOME_ISSUE_LABEL_SETTINGS,
  materializeTomeIssueLabels,
  TOME_ISSUE_LABEL_KEYS,
  type TomeIssueLabelKey,
  type TomeIssueLabelSettings,
} from "@/lib/tome/issue-filter-views";

interface IssueLabelSettingsResponse extends TomeIssueLabelSettings {
  version: number;
  updated_at: string | null;
  updated_by: string | null;
}

const LABEL_DESCRIPTIONS: Record<TomeIssueLabelKey, string> = {
  critical: "High-priority items that should be visible to leadership.",
  "needs-attention": "Items that are blocked, at risk, or need follow-up.",
  decision: "Decision records and discussions that should remain discoverable.",
};

const LABEL_TITLES: Record<TomeIssueLabelKey, string> = {
  critical: "Critical",
  "needs-attention": "Needs Attention",
  decision: "Decisions",
};

function copySettings(settings: TomeIssueLabelSettings): TomeIssueLabelSettings {
  return {
    labels: Object.fromEntries(
      TOME_ISSUE_LABEL_KEYS.map((key) => [key, {
        ...settings.labels[key],
        enabled: settings.labels[key].enabled !== false,
      }]),
    ) as TomeIssueLabelSettings["labels"],
  };
}

export function IssueLabelsTab() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<IssueLabelSettingsResponse | null>(null);
  const [draft, setDraft] = useState<TomeIssueLabelSettings>(
    copySettings(DEFAULT_TOME_ISSUE_LABEL_SETTINGS),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/tome/admin/issue-labels");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to load issue label settings");
      const next = body.data as IssueLabelSettingsResponse;
      setSettings(next);
      setDraft(copySettings(next));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load issue label settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const preview = useMemo(() => materializeTomeIssueLabels(draft), [draft]);
  const previewById = useMemo(
    () => new Map(preview.map((label) => [label.id, label])),
    [preview],
  );
  const enabledKeys = TOME_ISSUE_LABEL_KEYS.filter((key) => draft.labels[key].enabled !== false);
  const disabledKeys = TOME_ISSUE_LABEL_KEYS.filter((key) => draft.labels[key].enabled === false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings && copySettings(settings));

  const updateLabel = (key: TomeIssueLabelKey, field: "title" | "suffix", value: string) => {
    setDraft((current) => ({
      ...current,
      labels: {
        ...current.labels,
        [key]: { ...current.labels[key], [field]: value },
      },
    }));
  };

  const setLabelEnabled = (key: TomeIssueLabelKey, enabled: boolean) => {
    setDraft((current) => ({
      ...current,
      labels: {
        ...current.labels,
        [key]: { ...current.labels[key], enabled },
      },
    }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/tome/admin/issue-labels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await response.json();
      if (!response.ok) {
        const details = Array.isArray(body.errors)
          ? `: ${body.errors.map((item: { message?: string }) => item.message).join(" ")}`
          : "";
        throw new Error(`${body.error ?? "Failed to save issue label settings"}${details}`);
      }
      const next = body.data as IssueLabelSettingsResponse;
      setSettings(next);
      setDraft(copySettings(next));
      toast("TOME issue label settings updated", "success");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save issue label settings");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setDraft(copySettings(DEFAULT_TOME_ISSUE_LABEL_SETTINGS));
    setError(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Issue labels</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure the GitHub labels TOME uses for its issue views. Labels default to the existing GitHub
          names without a <code>tome:</code> prefix, and each default label can be removed if it is not useful.
          These settings apply across all TOME projects.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading issue label settings…
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            Removing a label hides its view and stops TOME from offering it as a tracker. Existing label
            values are retained, so you can add the view back later. Changing a label keeps the previous
            value recognized as a legacy alias.
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Enabled labels</h3>
            {enabledKeys.map((key) => {
              const label = draft.labels[key];
              const materialized = previewById.get(key);
              return (
                <div key={key} className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h4 className="font-medium">{LABEL_TITLES[key]}</h4>
                      <p className="text-xs text-muted-foreground">{LABEL_DESCRIPTIONS[key]}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setLabelEnabled(key, false)}
                      disabled={saving}
                      aria-label={`Remove ${LABEL_TITLES[key]} label`}
                      title={`Remove ${LABEL_TITLES[key]} label`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Display name
                      <Input
                        value={label.title}
                        onChange={(event) => updateLabel(key, "title", event.target.value)}
                        className="mt-1"
                      />
                    </label>
                    <label className="text-xs font-medium text-muted-foreground">
                      GitHub label suffix
                      <Input
                        value={label.suffix}
                        onChange={(event) => updateLabel(key, "suffix", event.target.value)}
                        className="mt-1"
                      />
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    GitHub label: <code className="font-mono">{materialized?.label}</code>
                  </p>
                </div>
              );
            })}
            {enabledKeys.length === 0 && (
              <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                No default labels are enabled.
              </p>
            )}
          </div>

          {disabledKeys.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Available labels</h3>
              <div className="flex flex-wrap gap-2">
                {disabledKeys.map((key) => (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setLabelEnabled(key, true)}
                    disabled={saving}
                    className="gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add {LABEL_TITLES[key]}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={reset} disabled={!dirty || saving} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Reset draft
            </Button>
            <Button onClick={() => void save()} disabled={!dirty || saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save labels
            </Button>
          </div>
          {settings?.updated_by && (
            <p className="text-right text-xs text-muted-foreground">
              Last edited by {settings.updated_by}
            </p>
          )}
        </>
      )}
    </div>
  );
}
