"use client";

/**
 * What the digest should cover, how often, and where it should arrive.
 *
 * Three questions in the order a reader answers them. The subject first,
 * because it is the only one with no sensible default — a schedule can ship
 * as Monday morning, but nobody else can say what you want to hear about.
 *
 * The choices are stored on the reader even though nothing writes a digest
 * yet, so the form remembers and so whatever eventually runs has a schedule
 * to read rather than one invented at the point of writing.
 */

import { ChevronLeft } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api-client";
import {
  DEFAULT_DIGEST_CONFIG,
  DIGEST_FREQUENCIES,
  DIGEST_TOPIC_MAX,
  DIGEST_WEEKDAYS,
  digestConfigsDiffer,
  hourLabel,
  parseDigestConfig,
  usesWeekday,
  type DigestConfig,
  type DigestFrequency,
} from "@/lib/tome/digest-config";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function DigestConfigPanel({ onBack }: { onBack: () => void }) {
  const [config, setConfig] = React.useState<DigestConfig>(
    DEFAULT_DIGEST_CONFIG,
  );
  /** What is on the server, so Save can tell whether there is anything to do. */
  const [saved, setSaved] = React.useState<DigestConfig | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  /**
   * Whether this reader has written anything in this sitting.
   *
   * "Saved" is a reply to having pressed Save. Showing it on arrival would
   * answer a question nobody asked, about a form they have not touched.
   */
  const [acknowledged, setAcknowledged] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    apiClient
      .getSettings()
      .then((settings) => {
        if (cancelled) return;
        const stored = parseDigestConfig(settings?.notifications?.tome_digest);
        setConfig(stored);
        setSaved(stored);
      })
      .catch(() => {
        // The defaults are already on screen and are a usable answer, so a
        // settings document that will not load is not worth a dead end.
        if (!cancelled) setSaved(DEFAULT_DIGEST_CONFIG);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = saved !== null && digestConfigsDiffer(config, saved);

  const onSave = React.useCallback(async () => {
    setSaving(true);
    setFailed(false);
    const next: DigestConfig = {
      ...config,
      topic: config.topic.trim().slice(0, DIGEST_TOPIC_MAX),
    };
    try {
      await apiClient.updateNotifications({ tome_digest: next });
      setConfig(next);
      setSaved(next);
      setAcknowledged(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }, [config]);

  const set = React.useCallback(
    <K extends keyof DigestConfig>(key: K, value: DigestConfig[K]) =>
      setConfig((current) => ({ ...current, [key]: value })),
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground"
          onClick={onBack}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="sr-only">Back to the digest</span>
        </Button>
        <h2 className="text-xl font-semibold tracking-tight">
          Digest configuration
        </h2>
      </div>

      <Card className="mx-auto w-full max-w-2xl space-y-6 p-5">
        <section className="space-y-2">
          <Label htmlFor="digest-topic">What would you like to be updated on?</Label>
          <Textarea
            id="digest-topic"
            rows={4}
            maxLength={DIGEST_TOPIC_MAX}
            value={config.topic}
            onChange={(event) => set("topic", event.target.value)}
            placeholder="I'd like an overview of where each project stands, and anything waiting on a decision."
            className="resize-none"
          />
        </section>

        <section className="space-y-2">
          <Label htmlFor="digest-frequency">How often?</Label>
          {/* One sentence rather than three stacked fields: the schedule reads
              as a phrase, and a reader checking it should be able to read it
              the way they would say it. */}
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Select
              id="digest-frequency"
              aria-label="How often"
              className="w-auto min-w-[9rem]"
              value={config.frequency}
              onChange={(event) =>
                set("frequency", event.target.value as DigestFrequency)
              }
            >
              {DIGEST_FREQUENCIES.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </Select>

            {usesWeekday(config.frequency) && (
              <>
                <span>on</span>
                <Select
                  aria-label="Which day"
                  className="w-auto min-w-[8rem]"
                  value={String(config.weekday)}
                  onChange={(event) =>
                    set("weekday", Number(event.target.value))
                  }
                >
                  {DIGEST_WEEKDAYS.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </Select>
              </>
            )}

            <span>at</span>
            <Select
              aria-label="What time"
              className="w-auto min-w-[6rem]"
              value={String(config.hour)}
              onChange={(event) => set("hour", Number(event.target.value))}
            >
              {HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </Select>
          </div>
        </section>

        <section className="space-y-2">
          <Label>Where?</Label>
          {/*
            Shown and switched off rather than left out, so a reader can see
            that a digest will be able to arrive somewhere other than here.
            Nothing sends one yet, which is what the line below says.
          */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-foreground">Send on Webex</span>
            <Switch
              checked={false}
              onCheckedChange={() => undefined}
              disabled
              aria-label="Send on Webex"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Webex isn&apos;t connected yet. Connect Webex to enable this
            option.
          </p>
        </section>

        <div className="flex items-center justify-end gap-3">
          {failed && (
            <p className="text-xs text-destructive">
              That didn&apos;t save. Try again.
            </p>
          )}
          {!failed && !dirty && acknowledged && (
            <p className="text-xs text-muted-foreground">Saved</p>
          )}
          <Button size="sm" onClick={() => void onSave()} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
