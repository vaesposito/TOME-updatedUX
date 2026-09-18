/** @jest-environment node */
const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn();
const mockCreateIndex = jest.fn();
jest.mock('../mongodb', () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async () => ({ findOne: mockFindOne, updateOne: mockUpdateOne, createIndex: mockCreateIndex })),
}));
import { getRefreshFailure, recordRefreshFailure, refreshFingerprint, resetRefreshFailures } from '../auth-refresh-state';

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
  jest.clearAllMocks();
  mockFindOne.mockReset();
  mockUpdateOne.mockReset();
  resetRefreshFailures();
  mockCreateIndex.mockResolvedValue('expiresAt_1');
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

it('uses credential-free provider-scoped fingerprints', () => {
  const key = refreshFingerprint('https://idp.example.com', 'example', 'secret-sentinel');
  expect(key).toMatch(/^[a-f0-9]{64}$/);
  expect(key).not.toBe(refreshFingerprint('https://other.example.com', 'example', 'secret-sentinel'));
});

it('persists failures without credentials and creates an expiry index', async () => {
  const key = refreshFingerprint('https://idp.example.com', 'example', 'secret-sentinel');
  await recordRefreshFailure(key, 'terminal');
  expect(mockCreateIndex).toHaveBeenCalledWith({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  expect(mockUpdateOne).toHaveBeenCalledWith({ _id: key }, {
    $set: { outcome: 'terminal', expiresAt: new Date('2026-01-02T00:00:00Z') },
  }, { upsert: true });
  expect(JSON.stringify(mockUpdateOne.mock.calls)).not.toContain('secret-sentinel');
});

it('reads a terminal failure after a process restart / on a second replica', async () => {
  await recordRefreshFailure('key', 'terminal');
  const persisted = mockUpdateOne.mock.calls[0][1].$set;
  resetRefreshFailures();
  mockFindOne.mockResolvedValue({ _id: 'key', ...persisted });
  expect((await getRefreshFailure('key'))?.outcome).toBe('terminal');
  expect(mockFindOne).toHaveBeenCalledWith({ _id: 'key', expiresAt: { $gt: new Date() } });
});

it('expires transient suppression independently of asynchronous Mongo TTL cleanup', async () => {
  await recordRefreshFailure('key', 'transient');
  expect((await getRefreshFailure('key'))?.outcome).toBe('transient');
  jest.advanceTimersByTime(60_001);
  mockFindOne.mockResolvedValue(null);
  expect(await getRefreshFailure('key')).toBeUndefined();
  expect(mockFindOne).toHaveBeenCalledWith({ _id: 'key', expiresAt: { $gt: new Date() } });
});

it('never downgrades a terminal record to transient', async () => {
  await recordRefreshFailure('key', 'terminal');
  await recordRefreshFailure('key', 'transient');
  expect(mockUpdateOne).toHaveBeenCalledTimes(1);
  expect((await getRefreshFailure('key'))?.outcome).toBe('terminal');
});

it('retains local suppression when Mongo persistence is unavailable', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockUpdateOne.mockRejectedValue(new Error('database unavailable'));
  await recordRefreshFailure('key', 'terminal');
  expect((await getRefreshFailure('key'))?.outcome).toBe('terminal');
});
