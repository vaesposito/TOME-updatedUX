/** @jest-environment node */
jest.mock('../mongodb', () => ({ isMongoDBConfigured: false }));
jest.mock('../auth-token-store', () => ({
  getStoredTokens: jest.fn(), storeTokens: jest.fn(), resetTokenStore: jest.fn(),
}));
jest.mock('next-auth/jwt', () => ({ decode: jest.fn() }));
import { authOptions, _resetInflightRefreshes } from '../auth-config';
import { getStoredTokens } from '../auth-token-store';
import { refreshFingerprint } from '../auth-refresh-state';
import { decode } from 'next-auth/jwt';
import type { JWT } from 'next-auth/jwt';
import type { NextAuthOptions } from 'next-auth';

const originalEnv = process.env;
const now = () => Math.floor(Date.now() / 1000);
const token = (): JWT => ({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: now() + 120 });
const run = (value: JWT, force = true) => authOptions.callbacks!.jwt!({
  token: value, trigger: 'update', session: { forceRefresh: force },
} as Parameters<NonNullable<NonNullable<NextAuthOptions['callbacks']>['jwt']>>[0]);
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});
const good = { access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3600 };

beforeEach(() => {
  process.env = { ...originalEnv, OIDC_ISSUER: 'https://idp.example.com', OIDC_CLIENT_ID: 'example',
    OIDC_CLIENT_SECRET: 'secret-sentinel', OIDC_TOKEN_ENDPOINT: 'https://idp.example.com/token' };
  delete process.env.OIDC_DISCOVERY_URL;
  _resetInflightRefreshes();
  jest.mocked(getStoredTokens).mockReset();
  jest.spyOn(global, 'fetch').mockReset().mockImplementation(async () => response(good));
});
afterEach(() => { process.env = originalEnv; jest.restoreAllMocks(); jest.useRealTimers(); });

it('never follows credential-bearing redirects, disables caching and bounds request duration', async () => {
  await run(token());
  expect(fetch).toHaveBeenCalledWith('https://idp.example.com/token', expect.objectContaining({
    method: 'POST', redirect: 'error', cache: 'no-store', signal: expect.any(AbortSignal),
  }));
});

it.each(['file:///tmp/token', 'https://user:password@idp.example.com/token', 'https://idp.example.com/token#fragment'])
('rejects unsafe configured endpoints: %s', async (endpoint) => {
  process.env.OIDC_TOKEN_ENDPOINT = endpoint;
  const result = await run(token());
  expect(fetch).not.toHaveBeenCalled();
  expect(result.refreshSuppressedUntil).toBeGreaterThan(now());
});

it('uses generic OIDC discovery without appending Keycloak-specific routes', async () => {
  delete process.env.OIDC_TOKEN_ENDPOINT;
  process.env.OIDC_DISCOVERY_URL = 'https://idp.example.com/oauth2/default';
  jest.mocked(fetch).mockResolvedValueOnce(response({ token_endpoint: 'https://idp.example.com/oauth2/token' }));
  await run(token());
  expect(fetch).toHaveBeenNthCalledWith(1, 'https://idp.example.com/oauth2/default/.well-known/openid-configuration', expect.any(Object));
  expect(fetch).toHaveBeenNthCalledWith(2, 'https://idp.example.com/oauth2/token', expect.any(Object));
});

it('rejects HTTPS discovery downgrades before sending credentials', async () => {
  delete process.env.OIDC_TOKEN_ENDPOINT;
  jest.mocked(fetch).mockResolvedValueOnce(response({ token_endpoint: 'http://idp.example.com/token' }));
  await run(token());
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([null, [], {}, { ...good, access_token: '' }, { ...good, expires_in: -1 },
  { ...good, expires_in: '3600' }, { ...good, refresh_token: {} }, { ...good, id_token: 123 }])
('does not replace credentials with malformed success data: %j', async (body) => {
  jest.mocked(fetch).mockResolvedValueOnce(response(body));
  const result = await run(token());
  expect(result.accessToken).toBe('old-access');
  expect(result.refreshSuppressedUntil).toBeGreaterThan(now());
});

it('forced refresh respects transient backoff even when the caller replays an unchanged cookie', async () => {
  jest.useFakeTimers({ now: Date.now() });
  jest.mocked(fetch).mockResolvedValueOnce(new Response('<html>blocked</html>', { status: 403 }));
  const original = token();
  const failed = await run({ ...original });
  await run(failed);
  jest.advanceTimersByTime(20_000);
  const replayed = await run({ ...original });
  expect(replayed.refreshSuppressedUntil).toBe(failed.refreshSuppressedUntil);
  expect(fetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(41_000);
  expect((await run({ ...original })).accessToken).toBe('fresh-access');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('remembers invalid_grant across unchanged cookies without retrying the provider', async () => {
  jest.mocked(fetch).mockResolvedValueOnce(response({ error: 'invalid_grant' }, 400));
  const original = token();
  expect((await run({ ...original })).refreshTerminal).toBe(true);
  expect((await run({ ...original })).refreshTerminal).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not treat a missing access token as usable just because expiry is in the future', async () => {
  jest.mocked(fetch).mockResolvedValueOnce(response({ error: 'invalid_grant' }, 400));
  const result = await run({ ...token(), accessToken: undefined, error: 'AccessTokenMissing' });
  expect(result.error).toBe('RefreshTokenExpired');
});

it('allows AccessTokenMissing recovery', async () => {
  const result = await run({ ...token(), accessToken: undefined, error: 'AccessTokenMissing' });
  expect(result.error).toBeUndefined();
  expect(result.accessToken).toBe('fresh-access');
});

it('ignores provider fields that resemble internal refresh control state', async () => {
  jest.mocked(fetch).mockResolvedValueOnce(response({ ...good, outcome: 'terminal', receivedAt: 9_000_000_000 }));
  const result = await run(token());
  expect(result.error).toBeUndefined();
  expect(result.refreshTerminal).toBeUndefined();
  expect(result.expiresAt).toBeLessThanOrEqual(now() + 3600);
});

it('does not force refresh when disabled by configuration', async () => {
  process.env.OIDC_ENABLE_REFRESH_TOKEN = 'false';
  await jest.isolateModulesAsync(async () => {
    const { authOptions: disabled } = await import('../auth-config');
    await disabled.callbacks!.jwt!({ token: token(), trigger: 'update', session: { forceRefresh: true } } as never);
  });
  expect(fetch).not.toHaveBeenCalled();
});

it('does not log provider response bodies or exception details', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.mocked(fetch).mockResolvedValueOnce(response({ error: 'unknown', refresh_token: 'leak-sentinel' }, 500));
  await run(token());
  _resetInflightRefreshes();
  jest.mocked(fetch).mockRejectedValueOnce(new Error('leak-sentinel'));
  await run(token());
  expect(JSON.stringify([...warn.mock.calls, ...error.mock.calls])).not.toContain('leak-sentinel');
});

it.each(['unchanged', 'expired', 'missing-expiry'])('does not adopt %s peer tokens as refresh success', async (kind) => {
  jest.useFakeTimers({ now: Date.now() });
  jest.mocked(fetch).mockResolvedValueOnce(response({ error: 'invalid_grant' }, 400));
  jest.mocked(getStoredTokens).mockResolvedValue({ ...token(), version: 2,
    ...(kind !== 'unchanged' ? { accessToken: 'peer-access', refreshToken: 'peer-refresh',
      expiresAt: kind === 'expired' ? now() - 10 : undefined } : {}),
  });
  const pending = run({ ...token(), sub: 'example', tokenStoreVersion: 1 });
  await jest.runAllTimersAsync();
  expect((await pending).refreshTerminal).toBe(true);
});

it('clears credential-specific terminal flags after a peer supplies a different refresh token', async () => {
  jest.mocked(decode).mockResolvedValue({ sub: 'example', tokenStoreVersion: 1, refreshTerminal: true,
    error: 'RefreshTokenExpired', refreshFailureKey: refreshFingerprint('https://idp.example.com', 'example', 'old-refresh') });
  jest.mocked(getStoredTokens).mockResolvedValue({ accessToken: 'fresh-access', refreshToken: 'fresh-refresh',
    expiresAt: now() + 3600, version: 2 });
  const result = await authOptions.jwt!.decode!({ token: 'cookie', secret: 'example' });
  expect(result?.refreshTerminal).toBeUndefined();
  expect(result?.error).toBeUndefined();
});
