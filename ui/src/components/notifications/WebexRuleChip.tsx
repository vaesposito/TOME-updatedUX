"use client";

import { AlertTriangle, Send } from "lucide-react";
import * as React from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchablePicker } from "@/components/ui/searchable-picker";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { WebexDeliveryState } from "@/components/notifications/useWebexDelivery";
import {
  WEBEX_DELIVERY_CADENCE_LABELS,
  WEBEX_DELIVERY_DESTINATION_LABELS,
  WEBEX_WEEKDAY_LABELS,
  type WebexDeliveryCadence,
  type WebexDeliveryDestination,
  type WebexDeliveryRule,
  type WebexDeliverySpace,
} from "@/types/webex-delivery";

/**
 * Where a watched entity's updates go in Webex, configured from its own row.
 *
 * On the row rather than in a list of its own because the rule belongs to
 * the watch: deciding to watch a project and deciding where to hear about it
 * are one thought, and a separate tab made the reader find the same project
 * twice. Behind a popover rather than inline because the full set of
 * controls is five wide at its longest, and the tree has to stay a tree.
 */

/**
 * Short enough for a chip.
 *
 * Lowercase and abbreviated, unlike the full labels in the popover: the chip
 * is a reminder of a decision already made, so it says the least that still
 * distinguishes one rule from another.
 */
const CHIP_CADENCE: Record<WebexDeliveryCadence, string> = {
  immediate: "as it happens",
  daily: "daily",
  weekly: "weekly",
};

/**
 * Row-sized version of the shared select.
 *
 * The base is a full-height form control; several of these in a popover
 * needs the compact one. `py-0` is load-bearing — the base's vertical
 * padding clips a native select's own text once the height comes down.
 */
const FIELD_SELECT_CLASS = "h-8 w-full px-2 py-0 text-xs";

/** `09:00`, in the reader's own 24-hour terms rather than a locale guess. */
function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** What the chip says: the destination, then how often. */
function chipLabel(rule: WebexDeliveryRule): string | null {
  if (rule.destination === "off") return null;
  // A space was asked for but not named. Nothing is being sent and nothing
  // has been saved, so the chip says what is missing rather than reporting a
  // delivery that would not happen.
  if (rule.destination === "space" && !rule.space_id) return "Pick a space";
  const where =
    rule.destination === "direct" ? "DM" : rule.space_name || "A space";
  return `${where} · ${CHIP_CADENCE[rule.cadence]}`;
}

/** One labelled control, so the popover's fields line up in a column. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

export function WebexRuleChip({
  entitySlug,
  entityTitle,
  entityType,
  delivery,
  busy,
}: {
  entitySlug: string;
  entityTitle: string;
  entityType: WebexDeliveryRule["entity_type"];
  delivery: WebexDeliveryState;
  busy: boolean;
}) {
  const rule = delivery.ruleFor({
    entity_slug: entitySlug,
    entity_title: entityTitle,
    entity_type: entityType,
  });
  const label = chipLabel(rule);
  const configured = rule.destination !== "off";
  /** Enough has been chosen for something to actually be sent. */
  const sending = configured && (rule.destination !== "space" || !!rule.space_id);
  const scheduled = rule.cadence !== "immediate";
  const disabled = busy || delivery.busy;

  const selectedSpace = React.useMemo(
    () =>
      rule.space_id
        ? (delivery.spaces.find((space) => space.id === rule.space_id) ?? {
            id: rule.space_id,
            // The stored name, so a space the bot has since left still reads
            // as something the reader recognises rather than an opaque id.
            name: rule.space_name || rule.space_id,
          })
        : undefined,
    [rule.space_id, rule.space_name, delivery.spaces],
  );

  const change = (next: Partial<WebexDeliveryRule>) =>
    delivery.save({ ...rule, ...next });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-disabled={disabled}
          // Named for the project, because a tree of these is otherwise a
          // column of identical buttons to anyone reading it aloud.
          aria-label={
            label
              ? `Webex delivery for ${entityTitle}: ${label}`
              : `Send ${entityTitle} updates to Webex`
          }
          className={cn(
            "flex h-6 max-w-[14rem] shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] transition-colors",
            disabled && "pointer-events-none opacity-50",
            sending
              ? "border-border bg-muted/60 text-foreground/80 hover:bg-muted"
              : // Rows that send nothing are the common case, so theirs is
                // the quieter chip: dashed and unfilled, it offers the choice
                // without competing with the project's own name.
                "border-dashed border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
          )}
        >
          <Send className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{label ?? "Webex"}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        <p className="text-xs font-medium">Send to Webex</p>

        {delivery.capability.available ? null : (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px]">
            <AlertTriangle
              className="mt-px h-3.5 w-3.5 shrink-0 text-destructive"
              aria-hidden="true"
            />
            {/* Shown rather than hiding the controls: knowing the rule is
                saved and waiting on an administrator is more use than a
                dead popover. */}
            <span>{delivery.capability.reason}</span>
          </div>
        )}

        <Field label="Where">
          <Select
            className={FIELD_SELECT_CLASS}
            aria-label={`Where ${entityTitle} updates go`}
            disabled={disabled}
            value={rule.destination}
            onChange={(event) => {
              const destination = event.target.value as WebexDeliveryDestination;
              if (destination === "space") delivery.needSpaces();
              change({ destination });
            }}
          >
            {(
              Object.keys(WEBEX_DELIVERY_DESTINATION_LABELS) as WebexDeliveryDestination[]
            ).map((value) => (
              <option key={value} value={value}>
                {WEBEX_DELIVERY_DESTINATION_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>

        {/* Controls appear as they become relevant: a rule set to Off is a
            single dropdown, and only a digest asks what time, because
            offering a send hour next to "as it happens" invites the reader
            to set something that will be ignored. */}
        {rule.destination === "space" ? (
          <Field label="Space">
            <SearchablePicker<WebexDeliverySpace>
              options={delivery.spaces}
              {...(selectedSpace ? { selected: selectedSpace } : {})}
              onSelect={(space) =>
                change({ space_id: space.id, space_name: space.name })
              }
              getOptionKey={(space) => space.id}
              getOptionLabel={(space) => space.name}
              placeholder="Choose a space"
              searchPlaceholder="Search spaces"
              emptyLabel="The platform's Webex bot is not in any space yet."
              ariaLabel={`Webex space for ${entityTitle}`}
              disabled={disabled}
              loading={delivery.spacesState.loading}
              loadingLabel="Loading spaces"
              error={delivery.spacesState.error}
              onRetry={delivery.needSpaces}
              triggerClassName="h-8"
              // Inline, not portalled: the picker's own list would otherwise
              // open as a sibling of this popover rather than a descendant,
              // and clicking a space in it would read as a click outside —
              // closing the thing being configured before the choice lands.
              portalled={false}
              contentClassName="w-full"
              helperText={
                // Said once, where the choice is made: the bot's reach is
                // the single thing most likely to surprise someone whose
                // space is missing from this list.
                "Only spaces the platform's Webex bot has been added to can receive updates."
              }
            />
          </Field>
        ) : null}

        {configured ? (
          <Field label="How often">
            <Select
              className={FIELD_SELECT_CLASS}
              aria-label={`How often ${entityTitle} updates are sent`}
              disabled={disabled}
              value={rule.cadence}
              onChange={(event) =>
                change({ cadence: event.target.value as WebexDeliveryCadence })
              }
            >
              {(
                Object.keys(WEBEX_DELIVERY_CADENCE_LABELS) as WebexDeliveryCadence[]
              ).map((value) => (
                <option key={value} value={value}>
                  {WEBEX_DELIVERY_CADENCE_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {configured && scheduled ? (
          <div className="flex items-end gap-2">
            {rule.cadence === "weekly" ? (
              <div className="min-w-0 flex-1">
                <Field label="Day">
                  <Select
                    className={FIELD_SELECT_CLASS}
                    aria-label={`Day ${entityTitle} digests are sent`}
                    disabled={disabled}
                    value={rule.weekday}
                    onChange={(event) =>
                      change({ weekday: Number(event.target.value) })
                    }
                  >
                    {WEBEX_WEEKDAY_LABELS.map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            ) : null}

            <div className="w-[5.5rem] shrink-0">
              <Field label="Time">
                <Select
                  className={FIELD_SELECT_CLASS}
                  aria-label={`Time ${entityTitle} digests are sent`}
                  disabled={disabled}
                  value={rule.hour}
                  onChange={(event) => change({ hour: Number(event.target.value) })}
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {hourLabel(hour)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        ) : null}

        {configured && scheduled ? (
          // The zone the hour is read in, named rather than assumed: someone
          // who set this on a laptop in another country should be able to see
          // which 9am they asked for.
          <p className="text-[11px] text-muted-foreground">{rule.timezone}</p>
        ) : null}

        {rule.destination === "space" && !rule.space_id ? (
          <p className="text-[11px] text-foreground/70">
            Pick a space to start sending.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
