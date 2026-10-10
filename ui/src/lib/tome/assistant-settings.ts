export type TomeLiveVerificationMode = "off" | "on_demand" | "automatic";

export interface TomeAssistantSettings {
  tome_assistant_popup_enabled: boolean;
  tome_live_verification_mode: TomeLiveVerificationMode;
}

export const DEFAULT_TOME_ASSISTANT_SETTINGS: TomeAssistantSettings = {
  tome_assistant_popup_enabled: false,
  tome_live_verification_mode: "off",
};

export const TOME_ASSISTANT_SETTINGS_EVENT = "tome:assistant-settings-changed";
