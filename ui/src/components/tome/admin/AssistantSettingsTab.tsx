"use client";

import { Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { TOME_ASSISTANT_SETTINGS_EVENT, type TomeLiveVerificationMode } from "@/lib/tome/assistant-settings";

export function AssistantSettingsTab() {
  const { toast } = useToast();
  const [saved, setSaved] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<TomeLiveVerificationMode>("off");
  const [savedMode, setSavedMode] = useState<TomeLiveVerificationMode>("off");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/tome/assistant-settings", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to load assistant settings");
      const value = body.data?.tome_assistant_popup_enabled === true;
      setSaved(value);
      setEnabled(value);
      const liveMode = body.data?.tome_live_verification_mode === "on_demand" || body.data?.tome_live_verification_mode === "automatic"
        ? body.data.tome_live_verification_mode : "off";
      setMode(liveMode);
      setSavedMode(liveMode);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to load assistant settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/tome/assistant-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tome_assistant_popup_enabled: enabled, tome_live_verification_mode: mode }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to save assistant settings");
      setSaved(body.data.tome_assistant_popup_enabled);
      setSavedMode(body.data.tome_live_verification_mode);
      window.dispatchEvent(new Event(TOME_ASSISTANT_SETTINGS_EVENT));
      toast("Assistant settings saved", "success");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to save assistant settings");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p role="status" className="text-sm text-muted-foreground">Loading assistant settings…</p>;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-start justify-between gap-6 rounded-lg border p-4">
        <div className="space-y-1">
          <label htmlFor="tome-assistant-popup" className="text-sm font-medium">Ask Tome popup</label>
          <p id="tome-assistant-popup-description" className="text-sm text-muted-foreground">
            Show Ask Tome on Projects and wiki pages. Off by default. Changes apply to open pages within 30 seconds.
          </p>
        </div>
        <Switch id="tome-assistant-popup" aria-describedby="tome-assistant-popup-description"
          checked={enabled} onCheckedChange={setEnabled} disabled={saving || Boolean(error)} />
      </div>
      <div className="space-y-2 rounded-lg border p-4">
        <label htmlFor="tome-live-verification" className="text-sm font-medium">Live Confluence verification</label>
        <Select id="tome-live-verification" value={mode} onChange={(event) => setMode(event.target.value as TomeLiveVerificationMode)}
          disabled={saving || Boolean(error)} aria-describedby="tome-live-verification-description">
          <option value="off">Off</option>
          <option value="on_demand">On demand</option>
          <option value="automatic">Automatic</option>
        </Select>
        <p id="tome-live-verification-description" className="text-sm text-muted-foreground">
          Off uses published TOME evidence. On demand lets users request live checks per question.
          Automatic checks time-sensitive questions and evidence described as stale. Requires the user’s connected Atlassian credential;
          unavailable or incomplete reads remain unverified. Live checks do not update the wiki.
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        The Tome Agent in regular GRID chat uses the global assistant whether the popup is on or off.
        User permissions apply to both entry points.
      </p>
      {error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={() => void load()} disabled={saving}>Reload settings</Button></div>}
      <Button onClick={() => void save()} disabled={saving || Boolean(error) || enabled === saved && mode === savedMode}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Save settings
      </Button>
    </div>
  );
}
