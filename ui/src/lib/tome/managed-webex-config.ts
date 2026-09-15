const DEFAULT_PROVIDER = "webex_messaging";

export interface ManagedWebexConfig {
  enabled: boolean;
  provider: string;
  accountEmail: string;
}

function enabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function getManagedWebexConfig(
  env: NodeJS.ProcessEnv = process.env,
): ManagedWebexConfig {
  return {
    enabled: enabled(env.TOME_MANAGED_WEBEX_MESSAGING_ENABLED),
    provider:
      clean(env.TOME_MANAGED_WEBEX_MESSAGING_PROVIDER) || DEFAULT_PROVIDER,
    accountEmail: clean(env.TOME_MANAGED_WEBEX_MESSAGING_ACCOUNT_EMAIL).toLowerCase(),
  };
}

export function isProtectedManagedWebexConnection(input: {
  owner: { type: string; id: string; email?: string };
  provider: string;
}): boolean {
  const config = getManagedWebexConfig();
  return Boolean(
    config.accountEmail &&
      input.owner.type === "user" &&
      input.owner.email?.trim().toLowerCase() === config.accountEmail &&
      input.provider === config.provider,
  );
}
