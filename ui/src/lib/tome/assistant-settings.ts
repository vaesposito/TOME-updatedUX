export interface TomeAssistantSettings {
  tome_assistant_popup_enabled: boolean;
}

export const DEFAULT_TOME_ASSISTANT_SETTINGS: TomeAssistantSettings = {
  tome_assistant_popup_enabled: false,
};

export const TOME_ASSISTANT_SETTINGS_EVENT = "tome:assistant-settings-changed";
