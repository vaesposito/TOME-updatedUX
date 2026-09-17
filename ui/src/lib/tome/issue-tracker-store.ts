import type { Document } from "mongodb";

import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  DEFAULT_TOME_ISSUE_LABEL_SETTINGS,
  materializeTomeIssueLabels,
  normalizeCustomTomeTrackerLabels,
  TOME_ISSUE_LABEL_KEYS,
  TOME_TRACKER_PREFIX,
  tomeTrackedIssueLabel,
  type TomeIssueLabelSettings,
  type TomeIssueLabelKey,
  type TomeTrackedIssueLabel,
} from "@/lib/tome/issue-filter-views";

const TOME_ISSUE_TRACKERS_COLLECTION = "tome_issue_trackers";
export const TOME_ISSUE_LABEL_SETTINGS_COLLECTION = "tome_issue_label_settings";
const TOME_ISSUE_LABEL_SETTINGS_ID = "global";

interface TomeIssueTrackerDocument extends Document {
  project_id: string;
  labels: string[];
  disabled_labels?: string[];
  updated_at: Date;
}

export interface TomeIssueLabelSettingsDocument extends TomeIssueLabelSettings {
  _id: string;
  /** Legacy persisted field; new settings no longer expose or write it. */
  use_prefix?: boolean;
  legacy_labels: Partial<Record<TomeIssueLabelKey, string[]>>;
  version: number;
  updated_at: string | null;
  updated_by: string | null;
}

async function trackersCollection() {
  return getCollection<TomeIssueTrackerDocument>(TOME_ISSUE_TRACKERS_COLLECTION);
}

async function labelSettingsCollection() {
  return getCollection<TomeIssueLabelSettingsDocument>(TOME_ISSUE_LABEL_SETTINGS_COLLECTION);
}

function defaultLabelSettingsDocument(): TomeIssueLabelSettingsDocument {
  return {
    _id: TOME_ISSUE_LABEL_SETTINGS_ID,
    labels: Object.fromEntries(
      Object.entries(DEFAULT_TOME_ISSUE_LABEL_SETTINGS.labels).map(([key, value]) => [key, { ...value }]),
    ) as TomeIssueLabelSettings["labels"],
    legacy_labels: {},
    version: 0,
    updated_at: null,
    updated_by: null,
  };
}

function mergeLabelSettings(
  document: Partial<TomeIssueLabelSettingsDocument> | null | undefined,
): TomeIssueLabelSettingsDocument {
  const defaults = defaultLabelSettingsDocument();
  const labels = Object.fromEntries(
    Object.entries(defaults.labels).map(([key, defaultValue]) => {
      const configured = document?.labels?.[key as keyof TomeIssueLabelSettings["labels"]];
      return [key, {
        ...defaultValue,
        ...(configured && typeof configured === "object" ? configured : {}),
      }];
    }),
  ) as TomeIssueLabelSettings["labels"];
  // Older settings used `tome:` labels. Keep those labels as aliases while
  // migrating the active labels to the unprefixed defaults.
  const legacyLabels = Object.fromEntries(
    TOME_ISSUE_LABEL_KEYS.map((key) => {
      const configured = labels[key];
      const oldPrefixedLabel = document?.use_prefix === true
        ? `${TOME_TRACKER_PREFIX}${configured.suffix.trim().toLowerCase()}`
        : null;
      return [key, [...new Set([
        ...(document?.legacy_labels?.[key] ?? []),
        ...(oldPrefixedLabel ? [oldPrefixedLabel] : []),
      ])].filter((alias) => alias !== configured.suffix.trim().toLowerCase()).slice(-10)];
    }),
  ) as Partial<Record<TomeIssueLabelKey, string[]>>;
  return {
    _id: typeof document?._id === "string" ? document._id : defaults._id,
    labels,
    legacy_labels: legacyLabels,
    version: typeof document?.version === "number" ? document.version : defaults.version,
    updated_at: typeof document?.updated_at === "string" ? document.updated_at : defaults.updated_at,
    updated_by: typeof document?.updated_by === "string" ? document.updated_by : defaults.updated_by,
  };
}

export async function readTomeIssueLabelSettings(): Promise<TomeIssueLabelSettingsDocument> {
  if (!isMongoDBConfigured) return defaultLabelSettingsDocument();
  const document = await (await labelSettingsCollection()).findOne({
    _id: TOME_ISSUE_LABEL_SETTINGS_ID,
  });
  return mergeLabelSettings(document);
}

export interface TomeIssueLabelSettingsValidationError {
  field: string;
  message: string;
}

export class TomeIssueLabelSettingsValidationFailure extends Error {
  constructor(public readonly errors: TomeIssueLabelSettingsValidationError[]) {
    super("TOME issue label settings validation failed");
    this.name = "TomeIssueLabelSettingsValidationFailure";
  }
}

function validateLabelPart(
  value: unknown,
  field: string,
  maxLength: number,
): TomeIssueLabelSettingsValidationError | null {
  if (typeof value !== "string" || !value.trim()) {
    return { field, message: "A non-empty value is required." };
  }
  if (value.trim().length > maxLength || /[\r\n]/.test(value)) {
    return { field, message: `Value must be at most ${maxLength} characters and contain no line breaks.` };
  }
  return null;
}

export function validateTomeIssueLabelSettings(
  input: Partial<TomeIssueLabelSettings> | null | undefined,
): TomeIssueLabelSettingsValidationError[] {
  const errors: TomeIssueLabelSettingsValidationError[] = [];
  if (!input?.labels || typeof input.labels !== "object") {
    return [...errors, { field: "labels", message: "All issue label settings are required." }];
  }
  const seen = new Set<string>();
  for (const key of Object.keys(DEFAULT_TOME_ISSUE_LABEL_SETTINGS.labels) as Array<keyof TomeIssueLabelSettings["labels"]>) {
    const setting = input.labels[key];
    if (setting?.enabled !== undefined && typeof setting.enabled !== "boolean") {
      errors.push({ field: `labels.${key}.enabled`, message: "enabled must be a boolean." });
    }
    const titleError = validateLabelPart(setting?.title, `labels.${key}.title`, 80);
    const suffixError = validateLabelPart(
      setting?.suffix,
      `labels.${key}.suffix`,
      50,
    );
    if (titleError) errors.push(titleError);
    if (suffixError) errors.push(suffixError);
    if (!suffixError) {
      const normalized = setting.suffix.trim().toLowerCase();
      if (seen.has(normalized)) {
        errors.push({ field: `labels.${key}.suffix`, message: "Each issue label must be unique." });
      }
      seen.add(normalized);
    }
  }
  return errors;
}

export async function saveTomeIssueLabelSettings(
  input: TomeIssueLabelSettings,
  updatedBy: string | null,
): Promise<TomeIssueLabelSettingsDocument> {
  const errors = validateTomeIssueLabelSettings(input);
  if (errors.length) throw new TomeIssueLabelSettingsValidationFailure(errors);
  const current = await readTomeIssueLabelSettings();
  const document: TomeIssueLabelSettingsDocument = {
    _id: TOME_ISSUE_LABEL_SETTINGS_ID,
    labels: Object.fromEntries(
      Object.entries(input.labels).map(([key, value]) => [key, {
        title: value.title.trim(),
        suffix: value.suffix.trim().toLowerCase(),
        enabled: value.enabled !== false,
      }]),
    ) as TomeIssueLabelSettings["labels"],
    legacy_labels: Object.fromEntries(
      TOME_ISSUE_LABEL_KEYS.map((typedKey) => {
        const previous = current.labels[typedKey]?.suffix.trim().toLowerCase();
        const next = input.labels[typedKey].suffix.trim().toLowerCase();
        const aliases = [
          ...(current.legacy_labels[typedKey] ?? []),
          ...(previous && previous !== next ? [previous] : []),
        ];
        return [typedKey, [...new Set(aliases)].filter((alias) => alias !== next).slice(-10)];
      }),
    ) as Partial<Record<TomeIssueLabelKey, string[]>>,
    version: current.version + 1,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  };
  if (isMongoDBConfigured) {
    await (await labelSettingsCollection()).replaceOne(
      { _id: TOME_ISSUE_LABEL_SETTINGS_ID },
      document,
      { upsert: true },
    );
  }
  return document;
}

export async function readTomeCustomIssueTrackers(projectId: string): Promise<string[]> {
  const trackers = await trackersCollection();
  const document = await trackers.findOne(
    { project_id: projectId },
    { projection: { _id: 0, labels: 1 } },
  );
  return normalizeCustomTomeTrackerLabels(
    document?.labels,
    "",
  );
}

export async function addTomeCustomIssueTracker(
  projectId: string,
  label: string,
): Promise<string[]> {
  const trackers = await trackersCollection();
  await trackers.updateOne(
    { project_id: projectId },
    {
      $set: { project_id: projectId, updated_at: new Date() },
      $addToSet: { labels: label },
    },
    { upsert: true },
  );
  return readTomeCustomIssueTrackers(projectId);
}

export async function removeTomeCustomIssueTracker(
  projectId: string,
  label: string,
): Promise<string[]> {
  const trackers = await trackersCollection();
  const document = await trackers.findOne(
    { project_id: projectId },
    { projection: { _id: 0, labels: 1 } },
  );
  const normalizedLabel = label.trim().toLowerCase();
  const labels = document?.labels ?? [];
  const labelsToRemove = labels.filter((candidate) =>
    normalizeCustomTomeTrackerLabels([candidate], "").includes(normalizedLabel),
  );
  if (labelsToRemove.length > 0) {
    await trackers.updateOne(
      { project_id: projectId },
      {
        $set: {
          labels: labels.filter((candidate) => !labelsToRemove.includes(candidate)),
          updated_at: new Date(),
        },
      },
    );
  }
  return readTomeCustomIssueTrackers(projectId);
}

export async function enableTomeIssueTracker(
  projectId: string,
  label: string,
): Promise<void> {
  const trackers = await trackersCollection();
  const document = await trackers.findOne(
    { project_id: projectId },
    { projection: { _id: 0, disabled_labels: 1 } },
  );
  const normalizedLabel = label.trim().toLowerCase();
  const disabledLabels = (document?.disabled_labels ?? []).filter(
    (candidate) => candidate !== normalizedLabel,
  );
  if (disabledLabels.length !== (document?.disabled_labels ?? []).length) {
    await trackers.updateOne(
      { project_id: projectId },
      { $set: { disabled_labels: disabledLabels, updated_at: new Date() } },
    );
  }
}

export async function removeTomeIssueTracker(
  projectId: string,
  label: string,
): Promise<void> {
  const settings = await readTomeIssueLabelSettings();
  const normalizedLabel = label.trim().toLowerCase();
  const builtIn = materializeTomeIssueLabels(settings, settings.legacy_labels).find(
    (tracked) => tracked.label === normalizedLabel || tracked.aliases?.includes(normalizedLabel),
  );
  if (!builtIn) {
    await removeTomeCustomIssueTracker(projectId, normalizedLabel);
    return;
  }

  const trackers = await trackersCollection();
  await trackers.updateOne(
    { project_id: projectId },
    {
      $set: { project_id: projectId, updated_at: new Date() },
      $addToSet: { disabled_labels: builtIn.label },
    },
    { upsert: true },
  );
}

export async function listTomeTrackedIssueLabels(
  projectIds: string[],
): Promise<TomeTrackedIssueLabel[]> {
  const [trackers, settings] = await Promise.all([
    trackersCollection(),
    readTomeIssueLabelSettings(),
  ]);
  const documents = await trackers.find(
    { project_id: { $in: projectIds } },
    { projection: { _id: 0, labels: 1, disabled_labels: 1 } },
  ).toArray();
  const custom = normalizeCustomTomeTrackerLabels(
    documents.flatMap((document) => document.labels),
    "",
  );
  const disabledLabels = new Set(documents.flatMap((document) => document.disabled_labels ?? []));
  const builtIn = materializeTomeIssueLabels(settings, settings.legacy_labels)
    .filter((tracked) => !disabledLabels.has(tracked.label));
  const builtInLabels = new Set(
    builtIn.flatMap(({ label, aliases }) => [label, ...(aliases ?? [])]),
  );
  return [
    ...builtIn,
    ...custom
      .filter((label) => !builtInLabels.has(label))
      .map(tomeTrackedIssueLabel),
  ];
}
