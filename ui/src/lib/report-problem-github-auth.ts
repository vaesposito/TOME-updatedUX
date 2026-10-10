import { createPrivateKey, sign } from "node:crypto";

import { ApiError } from "@/lib/api-middleware";

type GitHubPermission = "issues" | "contents";

interface InstallationToken {
  token: string;
  expiresAt: number;
}

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const tokens = new Map<string, InstallationToken>();
const pending = new Map<string, Promise<InstallationToken>>();

function env(name: string): string | undefined {
  return process.env[name]?.trim();
}

function legacyToken(): string | undefined {
  for (const name of ["REPORT_PROBLEM_GITHUB_TOKEN", "GITHUB_TICKET_TOKEN", "GITHUB_TOKEN"]) {
    const value = process.env[name] || process.env[`NEXT_PUBLIC_${name}`];
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

function privateKeyFrom(raw: string): string {
  const value = raw.replace(/\\n/g, "\n");
  if (value.includes("-----BEGIN ")) return value;
  const decoded = Buffer.from(value, "base64").toString("utf8");
  if (!decoded.includes("-----BEGIN ")) {
    throw new ApiError("GitHub App private key is invalid", 503, "ticket_app_key_invalid");
  }
  return decoded;
}

function appJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId })).toString("base64url");
  const content = `${header}.${claims}`;
  const signature = sign("RSA-SHA256", Buffer.from(content), createPrivateKey(privateKey)).toString("base64url");
  return `${content}.${signature}`;
}

async function installationToken(repoFullName: string, permission: GitHubPermission): Promise<InstallationToken> {
  const appId = env("REPORT_PROBLEM_GITHUB_APP_ID");
  const installationId = env("REPORT_PROBLEM_GITHUB_APP_INSTALLATION_ID");
  const rawKey = env("REPORT_PROBLEM_GITHUB_APP_PRIVATE_KEY");
  if (!appId || !installationId || !rawKey) {
    throw new ApiError("GitHub App credentials are not configured", 503, "ticket_app_not_configured");
  }
  if (!/^\d+$/.test(appId) || !/^\d+$/.test(installationId)) {
    throw new ApiError("GitHub App IDs are invalid", 503, "ticket_app_id_invalid");
  }
  const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(repoFullName);
  if (!match) {
    throw new ApiError("GitHub ticket repository is invalid", 503, "ticket_repo_invalid");
  }

  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${appJwt(appId, privateKeyFrom(rawKey))}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ repositories: [match[2]], permissions: { [permission]: "write" } }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new ApiError(`GitHub App authentication failed (${response.status})`, 502, "ticket_app_auth_failed");
  }
  const result = (await response.json()) as { token?: string; expires_at?: string };
  const expiresAt = Date.parse(result.expires_at ?? "");
  if (!result.token || !Number.isFinite(expiresAt)) {
    throw new ApiError("GitHub App returned an invalid token", 502, "ticket_app_token_invalid");
  }
  return { token: result.token, expiresAt };
}

/** Resolve a feedback credential without ever falling back to a PAT in app mode. */
export async function reportProblemGitHubToken(
  repoFullName: string,
  permission: GitHubPermission,
): Promise<string> {
  const mode = env("REPORT_PROBLEM_GITHUB_AUTH") || "pat";
  if (mode !== "app") {
    if (mode !== "pat") {
      throw new ApiError("GitHub ticket auth mode is invalid", 503, "ticket_auth_mode_invalid");
    }
    const token = legacyToken();
    if (!token) {
      throw new ApiError("GitHub ticket token is not configured", 503, "ticket_token_missing");
    }
    return token;
  }

  const key = `${repoFullName}:${permission}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return cached.token;
  let request = pending.get(key);
  if (!request) {
    request = installationToken(repoFullName, permission);
    pending.set(key, request);
  }
  try {
    const fresh = await request;
    tokens.set(key, fresh);
    return fresh.token;
  } finally {
    if (pending.get(key) === request) pending.delete(key);
  }
}
