import type { ProviderConnectionMetadata } from "@/lib/credentials/oauth-service";
import { getOAuthConnectorService, getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";

/** New personal space sources require this connector. Recorded meetings use a
 * separate setting; managed spaces keep their deployment-owned identity.
 */
export function webexSpaceProvider(): string {
  return process.env.TOME_WEBEX_SPACE_PROVIDER?.trim() || "webex";
}

export function personalWebexSpaceConnection(
  connections: Pick<ProviderConnectionMetadata, "provider" | "status" | "id">[],
  allowLegacyFallback = true,
) {
  const preferred = webexSpaceProvider();
  const providers = allowLegacyFallback && preferred !== "webex" ? [preferred, "webex"] : [preferred];
  for (const provider of providers) {
    const connection = connections.find((item) => item.provider === provider && item.status === "connected");
    if (connection) return connection;
  }
  return undefined;
}

/** Select before refreshing: a refresh/access failure must not switch identities. */
export async function personalWebexSpaceToken(
  subject: string,
  allowLegacyFallback: boolean,
  forwarded?: Record<string, Record<string, string>>,
): Promise<{ provider: string; accessToken: string } | undefined> {
  if (!subject) return undefined;
  const service = await getProviderConnectionService();
  const connection = personalWebexSpaceConnection(
    await service.listConnections({ type: "user", id: subject }), allowLegacyFallback,
  );
  if (!connection) return undefined;
  const accessToken = forwarded?.[connection.provider]?.access_token
    || (await service.refreshConnection(connection.id)).accessToken;
  return accessToken ? { provider: connection.provider, accessToken } : undefined;
}

export async function webexSpaceConnectionLabel(provider = webexSpaceProvider()): Promise<{ provider: string; name: string }> {
  try {
    const service = await getOAuthConnectorService();
    const connector = (await service.listConnectors()).find((item) => item.provider === provider);
    if (connector?.name) return { provider, name: connector.name };
  } catch {
    // The provider ID remains an exact, safe label if the catalog is unavailable.
  }
  return { provider, name: provider === "webex" ? "Webex" : provider };
}
