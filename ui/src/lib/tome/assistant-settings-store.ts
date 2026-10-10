import { ApiError } from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { PLATFORM_CONFIG_ID } from "@/lib/platform-default-agent";
import {
  DEFAULT_TOME_ASSISTANT_SETTINGS,
  type TomeAssistantSettings,
  type TomeLiveVerificationMode,
} from "@/lib/tome/assistant-settings";

interface AssistantSettingsDocument {
  _id: string;
  tome_assistant_popup_enabled?: unknown;
  tome_live_verification_mode?: unknown;
}

export function validateTomeLiveVerificationMode(value: unknown): TomeLiveVerificationMode {
  if (value !== "off" && value !== "on_demand" && value !== "automatic") {
    throw new ApiError("tome_live_verification_mode must be off, on_demand or automatic", 400, "INVALID_TOME_LIVE_VERIFICATION_MODE");
  }
  return value;
}

export function validateTomeAssistantPopupEnabled(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new ApiError(
      "tome_assistant_popup_enabled must be a boolean",
      400,
      "INVALID_TOME_ASSISTANT_POPUP_ENABLED",
    );
  }
  return value;
}

export async function readTomeAssistantSettings(): Promise<TomeAssistantSettings> {
  if (!isMongoDBConfigured) return { ...DEFAULT_TOME_ASSISTANT_SETTINGS };
  const collection = await getCollection<AssistantSettingsDocument>("platform_config");
  const document = await collection.findOne({ _id: PLATFORM_CONFIG_ID });
  return { tome_assistant_popup_enabled: document?.tome_assistant_popup_enabled === true,
    tome_live_verification_mode: document?.tome_live_verification_mode === "on_demand" || document?.tome_live_verification_mode === "automatic"
      ? document.tome_live_verification_mode : "off" };
}

export async function saveTomeAssistantSettings(
  enabled: unknown,
  actorEmail: string,
  mode?: unknown,
): Promise<TomeAssistantSettings> {
  if (enabled === undefined && mode === undefined) {
    throw new ApiError("At least one assistant setting is required", 400, "BAD_REQUEST");
  }
  const updates = {
    ...(enabled !== undefined ? { tome_assistant_popup_enabled: validateTomeAssistantPopupEnabled(enabled) } : {}),
    ...(mode !== undefined ? { tome_live_verification_mode: validateTomeLiveVerificationMode(mode) } : {}),
  };
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }
  const collection = await getCollection<AssistantSettingsDocument>("platform_config");
  await collection.updateOne({ _id: PLATFORM_CONFIG_ID }, {
    $set: {
      ...updates,
      updated_at: new Date(),
      updated_by: actorEmail,
    },
  }, { upsert: true });
  return readTomeAssistantSettings();
}
