import { ApiError } from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { PLATFORM_CONFIG_ID } from "@/lib/platform-default-agent";
import {
  DEFAULT_TOME_ASSISTANT_SETTINGS,
  type TomeAssistantSettings,
} from "@/lib/tome/assistant-settings";

interface AssistantSettingsDocument {
  _id: string;
  tome_assistant_popup_enabled?: unknown;
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
  return { tome_assistant_popup_enabled: document?.tome_assistant_popup_enabled === true };
}

export async function saveTomeAssistantSettings(
  enabled: unknown,
  actorEmail: string,
): Promise<TomeAssistantSettings> {
  const value = validateTomeAssistantPopupEnabled(enabled);
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }
  const collection = await getCollection<AssistantSettingsDocument>("platform_config");
  await collection.updateOne({ _id: PLATFORM_CONFIG_ID }, {
    $set: {
      tome_assistant_popup_enabled: value,
      updated_at: new Date(),
      updated_by: actorEmail,
    },
  }, { upsert: true });
  return { tome_assistant_popup_enabled: value };
}
