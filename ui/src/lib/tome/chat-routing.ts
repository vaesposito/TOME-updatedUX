import { getConfiguredAgenticApp } from "@/lib/agentic-apps/config";
import { PLATFORM_AGENT_ID_PATTERN } from "@/lib/platform-default-agent";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { getAgentId } from "@/types/a2a";
import type { Conversation } from "@/types/mongodb";

/** Deployment-owned identity; popup visibility never selects a runtime. */
export function getTomeNativeChatAgentId(): string | null {
  if (!isTomeServerEnabled()) return null;
  const configuredId = process.env.TOME_CHAT_AGENT_ID?.trim();
  if (configuredId) {
    if (!PLATFORM_AGENT_ID_PATTERN.test(configuredId)) throw new Error("Invalid TOME_CHAT_AGENT_ID");
    return configuredId;
  }
  const app = getConfiguredAgenticApp("tome");
  if (!app?.installation.installed || !app.installation.enabled) return null;
  return app.manifest.assistant?.agentId?.trim() || null;
}

/** Derive routing for both new and existing browser chats from the binding. */
export function withTomeChatRouting<T extends Conversation>(
  conversation: T,
  nativeAgentId: string | null,
): T {
  const metadata = { ...conversation.metadata };
  delete metadata.assistant_runtime;
  if (nativeAgentId && getAgentId(conversation) === nativeAgentId &&
      conversation.client_type === "webui" && !conversation.created_by_service_account) {
    metadata.assistant_runtime = "tome-native";
    metadata.agentic_app_id = "tome";
    metadata.agentic_app_agent_id = nativeAgentId;
  }
  return { ...conversation, metadata };
}
