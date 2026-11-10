"use client";

/**
 * What a dynamic page should say, and where the agent should look for it.
 *
 * Only a dynamic page has an agent writing it, so only a dynamic page has
 * prompts to shape; stable pages are written by hand and have nothing here
 * to configure. Drawn as a footer region of the editor itself, under the
 * writing area, since it configures how that page gets written rather than
 * standing beside it.
 *
 * Presentation only: the fields live in this component for now, so nothing
 * typed here is sent anywhere or survives leaving the page.
 */

import { useId, useMemo, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * A source prompt may name something this space has no connection to, which
 * the agent could not read even if it wanted to. Until the real check
 * exists, an explicit mention of a source stands in for it.
 */
const UNCONFIGURED_SOURCE = /\b(jira|salesforce)\b/i;

export function CustomPromptsPanel() {
  const [expanded, setExpanded] = useState(false);
  const [contentPrompt, setContentPrompt] = useState("");
  const [sourcePrompt, setSourcePrompt] = useState("");
  const bodyId = useId();
  const contentId = useId();
  const sourceId = useId();

  const unconfiguredSource = useMemo(
    () => UNCONFIGURED_SOURCE.test(sourcePrompt),
    [sourcePrompt],
  );
  const filled = contentPrompt.trim().length > 0 || sourcePrompt.trim().length > 0;

  return (
    <section
      className="border-t bg-muted/20"
      data-testid="tome-custom-prompts"
    >
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="flex w-full items-start gap-3 px-5 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Custom prompts</span>
          <span className="block text-xs text-muted-foreground">
            Configure what you would like to display on your page and specify
            where the sources should be retrieved from.
          </span>
        </span>
        <ChevronDown
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div
          id={bodyId}
          // Capped and scrolled: this sits under the writing area, and
          // expanding it must never leave that area with no room left.
          className="flex max-h-[40vh] flex-col gap-4 overflow-y-auto px-5 pb-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={contentId}>Content prompt</Label>
            <Textarea
              id={contentId}
              rows={4}
              value={contentPrompt}
              onChange={(event) => setContentPrompt(event.target.value)}
              placeholder="Describe how the page should be structured and what content it should include."
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={sourceId}>Source prompt</Label>
            <Textarea
              id={sourceId}
              rows={5}
              value={sourcePrompt}
              onChange={(event) => setSourcePrompt(event.target.value)}
              placeholder="Specify which sources the agent should use to retrieve the information required to populate the desired structure."
              aria-invalid={unconfiguredSource}
              aria-describedby={unconfiguredSource ? `${sourceId}-error` : undefined}
            />
            {unconfiguredSource && (
              <p
                id={`${sourceId}-error`}
                className="text-xs text-destructive"
                data-testid="tome-custom-prompts-source-error"
              >
                The requested source is not configured. Please configure it{" "}
                <a
                  href="../sources"
                  className="inline-flex items-center gap-0.5 underline underline-offset-2"
                >
                  here
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
                .
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!filled}
              onClick={() => {
                setContentPrompt("");
                setSourcePrompt("");
              }}
            >
              Clear all
            </Button>
            <Button type="button" size="sm" disabled={!filled}>
              Save
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
