import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { useTempHome, cleanupTempHomes, assertIsolated } from './helpers/home.mjs';

const home = useTempHome('mf-callback-robust-');
assertIsolated();
const PORT = 38107;
const savedEnv = {
  MF_CALLBACK_PORT: process.env.MF_CALLBACK_PORT,
  MF_REDIRECT_URI: process.env.MF_REDIRECT_URI,
};
process.env.MF_CALLBACK_PORT = String(PORT);
process.env.MF_REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const { OAuthManager } = await import('../dist/auth/oauth.js');

// Captured before any test mocks globalThis.fetch: the tests deliver callbacks
// over real HTTP while the production token exchange is mocked.
const realFetch = globalThis.fetch.bind(globalThis);

after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  cleanupTempHomes();
});

let sequence = 0;
function makeConfig() {
  return {
    name: 'expense',
    oauth: {
      clientId: 'test', clientSecret: 'test',
      authorizeUrl: 'https://example.invalid/authorize',
      tokenUrl: 'https://example.invalid/token', scopes: 'test',
    },
    api: { baseUrl: 'https://example.invalid' },
    storage: { tokensFile: path.join(home, `robust-${sequence++}`, 'tokens.json') },
  };
}

/**
 * Send a raw request line the URL parser cannot handle. `fetch` would refuse
 * to send this, so the socket is driven directly.
 */
function sendRawRequest(target) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(PORT, '127.0.0.1', () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('timed out')); });
    socket.on('data', (chunk) => { data += chunk.toString(); });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

test('A: a malformed request target answers 400 and leaves the flow pending', async (t) => {
  const warnings = [];
  t.mock.method(console, 'error', (...args) => warnings.push(args.join(' ')));

  const manager = new OAuthManager(makeConfig());
  const { tokenPromise } = await manager.startCallbackServerFlow();
  const settled = tokenPromise.then(() => ({ ok: true }), (error) => ({ ok: false, error }));

  // `//[` makes the URL constructor read an invalid authority and throw.
  // Before the fix this rejected with nothing attached, which terminates the
  // MCP process under Node's default unhandled-rejection policy.
  const response = await sendRawRequest('//[');
  assert.match(response, /^HTTP\/1\.1 400/, response.split('\r\n')[0]);

  // The process is still alive to make this assertion at all; the flow must
  // also be untouched, because this request never proved knowledge of state.
  assert.equal(manager.hasPendingFlow(), true);
  assert.equal(
    await Promise.race([settled, Promise.resolve('still-pending')]),
    'still-pending',
  );

  // One log line, and it must not contain the request target.
  const log = warnings.join('\n');
  assert.match(log, /不正なコールバックリクエスト/);
  assert.doesNotMatch(log, /\/\/\[/);

  manager.stopServer();
  await settled;
});

test('A: other unparseable targets are also contained', async (t) => {
  t.mock.method(console, 'error', () => {});
  const manager = new OAuthManager(makeConfig());
  const { tokenPromise } = await manager.startCallbackServerFlow();
  const settled = tokenPromise.catch(() => {});
  try {
    for (const target of ['//[', '//[::1', 'http://[', '//%']) {
      const response = await sendRawRequest(target);
      assert.match(response, /^HTTP\/1\.1 [45]\d\d/, `${target} -> ${response.split('\r\n')[0]}`);
      assert.equal(manager.hasPendingFlow(), true, `${target} cancelled the flow`);
    }
  } finally {
    manager.stopServer();
    await settled;
  }
});

test('B: a replaced flow cannot overwrite the newer credentials', async (t) => {
  const warnings = [];
  t.mock.method(console, 'error', (...args) => warnings.push(args.join(' ')));

  const config = makeConfig();
  const manager = new OAuthManager(config);

  // Hold the first flow's token exchange open until we say so.
  let releaseExchange;
  const exchangeReached = new Promise((resolve) => {
    t.mock.method(globalThis, 'fetch', async () => {
      resolve();
      await new Promise((r) => { releaseExchange = r; });
      return new Response(JSON.stringify({
        access_token: 'stale-from-flow-1',
        refresh_token: 'stale-refresh-1',
        expires_in: 3600,
      }), { status: 200 });
    });
  });

  const first = await manager.startCallbackServerFlow();
  const firstSettled = first.tokenPromise.then(() => ({ ok: true }), (error) => ({ ok: false, error }));
  const state = new URL(first.authUrl).searchParams.get('state');

  // Deliver flow 1's callback but do not wait for the response: the handler
  // parks inside the token exchange.
  const inFlight = realFetch(`http://127.0.0.1:${PORT}/callback?code=code-1&state=${state}`)
    .catch(() => null);
  await exchangeReached;

  // Flow 1 is replaced while its exchange is still running.
  const second = await manager.startCallbackServerFlow();
  const secondSettled = second.tokenPromise.catch(() => {});
  const firstResult = await firstSettled;
  assert.equal(firstResult.ok, false, 'the replaced flow must be rejected');

  // Now let flow 1's exchange finish. Its tokens must be discarded.
  releaseExchange();
  await inFlight;

  assert.equal(
    fs.existsSync(config.storage.tokensFile),
    false,
    'a stale flow wrote its tokens over the newer authentication',
  );
  assert.equal(manager.isAuthenticated(), false);
  assert.match(warnings.join('\n'), /中止された認証フローのトークン/);
  assert.doesNotMatch(warnings.join('\n'), /stale-from-flow-1|stale-refresh-1/);

  manager.stopServer();
  await secondSettled;
});

test('B: the surviving flow still saves its own tokens', async (t) => {
  t.mock.method(console, 'error', () => {});
  const config = makeConfig();
  const manager = new OAuthManager(config);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    access_token: 'fresh-token',
    refresh_token: 'fresh-refresh',
    expires_in: 3600,
  }), { status: 200 }));

  const flow = await manager.startCallbackServerFlow();
  const settled = flow.tokenPromise.then(() => ({ ok: true }), (error) => ({ ok: false, error }));
  const state = new URL(flow.authUrl).searchParams.get('state');

  const response = await realFetch(`http://127.0.0.1:${PORT}/callback?code=ok&state=${state}`);
  assert.equal(response.status, 200);
  const result = await settled;
  assert.equal(result.ok, true);
  assert.equal(manager.isAuthenticated(), true);
  assert.match(fs.readFileSync(config.storage.tokensFile, 'utf-8'), /fresh-token/);
  assert.equal(fs.statSync(config.storage.tokensFile).mode & 0o777, 0o600);
});
