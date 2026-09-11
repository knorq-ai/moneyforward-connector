import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome, cleanupTempHomes, assertIsolated } from './helpers/home.mjs';

// Adapted from the proposed patch: HOME goes through the shared helper.
useTempHome('mf-retry-');
assertIsolated();
const { ApiClient, parseRetryAfterSeconds } = await import('../dist/api/client.js');
const { rateLimiter } = await import('../dist/api/rate-limiter.js');

after(cleanupTempHomes);

test('parseRetryAfterSeconds handles seconds, HTTP-dates and junk', () => {
  assert.equal(parseRetryAfterSeconds(null), 1);
  assert.equal(parseRetryAfterSeconds('5'), 5);
  // Clamped so a hostile or broken header cannot stall a tool call for hours.
  assert.equal(parseRetryAfterSeconds('100000'), 60);
  assert.equal(parseRetryAfterSeconds('garbage'), 1);
  const future = new Date(Date.now() + 10_000).toUTCString();
  const secs = parseRetryAfterSeconds(future);
  assert.ok(secs >= 9 && secs <= 11, `expected ~10s, got ${secs}`);
  assert.equal(parseRetryAfterSeconds(new Date(Date.now() - 10_000).toUTCString()), 1);
});

for (const [label, invoke] of [
  ['JSON', (client) => client.post('/json', { value: 'test' })],
  ['multipart', (client) => client.postFormData('/upload', new FormData())],
]) {
  for (const [retryAfter, expectedDelays, expectedRequests] of [
    ['20', [20_000, 10_000], 2],
    ['60', [30_000], 1],
    ['0', [0, 0, 0], 4],
  ]) {
    test(`${label}: bounded total wait for Retry-After ${retryAfter}`, async (t) => {
      const client = new ApiClient('https://example.invalid', {
        getAccessToken: async () => 'test-token',
      });
      const delays = [];
      let requests = 0;
      // Independent of the shared limiter, including after a revert.
      t.mock.method(rateLimiter, 'waitForSlot', async () => {});
      t.mock.method(globalThis, 'fetch', async () => {
        requests++;
        return new Response('', { status: 429, headers: { 'Retry-After': retryAfter } });
      });
      t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
        delays.push(Number(delay));
        callback(...args);
        return 0;
      });

      // Each new top-level call gets its own budget.
      for (let call = 0; call < 2; call++) {
        delays.length = 0;
        requests = 0;
        let error;
        try {
          await invoke(client);
        } catch (caught) {
          error = caught;
        }
        assert.deepEqual(delays, expectedDelays);
        assert.equal(requests, expectedRequests);
        assert.ok(delays.reduce((sum, delay) => sum + delay, 0) <= 30_000);
        assert.match(error?.message ?? '', /429.*しばらく待ってから再度お試しください/);
      }
    });
  }
}
