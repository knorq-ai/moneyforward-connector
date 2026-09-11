import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { useTempHome, cleanupTempHomes, assertIsolated } from './helpers/home.mjs';

const PORT = 38099;
/** Network-facing tests get an explicit bound; --test-timeout needs Node 20.11+. */
const NET_TIMEOUT = { timeout: 20000 };

// Must happen before the import: the manager derives the token path and the
// legacy migration source from HOME. Without this, constructing a manager on a
// real installation would chmod the user's live token files.
const tmpDir = useTempHome('mf-callback-');
assertIsolated();
process.env.MF_CALLBACK_PORT = String(PORT);
process.env.MF_REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const { OAuthManager } = await import('../dist/auth/oauth.js');

function makeConfig() {
  return {
    // Deliberately not 'invoice': that name triggers the legacy-migration path,
    // which belongs in token-storage.test.mjs, not here.
    name: 'expense',
    oauth: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      // Pointed at a closed loopback port: if a test ever reached the token
      // exchange, it would fail loudly rather than talk to MoneyForward.
      authorizeUrl: 'http://127.0.0.1:1/authorize',
      tokenUrl: 'http://127.0.0.1:1/token',
      scopes: 'test.read',
    },
    api: { baseUrl: 'http://127.0.0.1:1' },
    storage: { tokensFile: path.join(tmpDir, 'invoice-tokens.json') },
  };
}

after(cleanupTempHomes);

/** Start a flow, run the body, and always tear the flow down. */
async function withFlow(body) {
  const manager = new OAuthManager(makeConfig());
  const { authUrl, tokenPromise } = await manager.startCallbackServerFlow();
  // Always attach a handler so a rejection never becomes an unhandled one.
  const settled = tokenPromise.then(
    (tokens) => ({ ok: true, tokens }),
    (error) => ({ ok: false, error }),
  );
  const state = new URL(authUrl).searchParams.get('state');
  try {
    return await body({ manager, state, settled, authUrl });
  } finally {
    manager.stopServer();
    await settled;
  }
}

const hit = (query) => fetch(`http://127.0.0.1:${PORT}/callback?${query}`);

test('the callback server binds only to loopback addresses', NET_TIMEOUT, async () => {
  await withFlow(({ manager }) => {
    const addrs = manager.getServerAddresses();
    assert.ok(addrs.length > 0, 'expected at least one listening socket');
    for (const { address, port } of addrs) {
      assert.equal(port, PORT);
      assert.ok(
        address === '127.0.0.1' || address === '::1',
        `listening on a non-loopback address: ${address}`,
      );
    }
    // The pre-fix code bound to 0.0.0.0 / ::, reachable from the LAN.
    assert.ok(!addrs.some((a) => a.address === '0.0.0.0' || a.address === '::'));
  });
});

test('state is validated BEFORE error, so a stranger cannot kill the flow', NET_TIMEOUT, async () => {
  await withFlow(async ({ manager, settled }) => {
    // A LAN peer (pre-fix: reachable) knows no state but can guess the path.
    const res = await hit('error=access_denied&state=wrong-state');
    assert.equal(res.status, 400);
    assert.match(await res.text(), /state/);

    // The decisive assertion: the flow is untouched. If `error` were handled
    // first, this request would have rejected tokenPromise and closed the
    // listener.
    assert.equal(manager.hasPendingFlow(), true);
    assert.equal(
      await Promise.race([settled, Promise.resolve('still-pending')]),
      'still-pending',
    );
  });
});

test('a callback with no state at all is ignored without touching the flow', NET_TIMEOUT, async () => {
  await withFlow(async ({ manager, settled }) => {
    const res = await hit('code=some-code');
    assert.equal(res.status, 400);
    assert.equal(manager.hasPendingFlow(), true);
    assert.equal(
      await Promise.race([settled, Promise.resolve('still-pending')]),
      'still-pending',
    );
  });
});

test('an OAuth error WITH the correct state does end the flow', NET_TIMEOUT, async () => {
  await withFlow(async ({ state, settled }) => {
    const res = await hit(`error=access_denied&state=${state}`);
    assert.equal(res.status, 400);
    const result = await settled;
    assert.equal(result.ok, false);
    assert.match(result.error.message, /access_denied/);
  });
});

test('the OAuth error is HTML-escaped in the response body', NET_TIMEOUT, async () => {
  await withFlow(async ({ state }) => {
    const res = await hit(`error=${encodeURIComponent('<script>alert(1)</script>')}&state=${state}`);
    const body = await res.text();
    assert.ok(!body.includes('<script>'), 'error value must not be interpolated raw');
    assert.match(body, /&lt;script&gt;/);
  });
});

test('a second callback on the same flow is refused as already processed', NET_TIMEOUT, async () => {
  await withFlow(async ({ state, settled }) => {
    const first = await hit(`error=access_denied&state=${state}`);
    assert.equal(first.status, 400);
    await settled;
    // The flow is gone, so the listener is closed: the second attempt is
    // refused at the TCP level. If a listener did survive, it must answer 4xx
    // rather than process the callback a second time.
    let secondStatus = 'connection-refused';
    try {
      secondStatus = (await hit(`error=access_denied&state=${state}`)).status;
    } catch (err) {
      assert.match(String(err.cause?.code ?? err.message), /ECONNREFUSED|ECONNRESET|socket/i);
    }
    if (secondStatus !== 'connection-refused') {
      assert.ok(secondStatus >= 400, `expected a refusal, got ${secondStatus}`);
    }
  });
});

test('restarting a flow settles the previous one instead of leaking it', NET_TIMEOUT, async () => {
  const manager = new OAuthManager(makeConfig());
  const first = await manager.startCallbackServerFlow();
  const firstSettled = first.tokenPromise.then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error }),
  );

  const second = await manager.startCallbackServerFlow();
  const secondSettled = second.tokenPromise.then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error }),
  );

  const firstResult = await firstSettled;
  assert.equal(firstResult.ok, false, 'the replaced flow must be settled, not left dangling');
  assert.match(firstResult.error.message, /中止/);

  // The replacement is still live and has a different state.
  assert.equal(manager.hasPendingFlow(), true);
  assert.notEqual(
    new URL(first.authUrl).searchParams.get('state'),
    new URL(second.authUrl).searchParams.get('state'),
  );

  manager.stopServer();
  await secondSettled;
});

test('paths other than /callback are not served', NET_TIMEOUT, async () => {
  await withFlow(async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/`);
    assert.equal(res.status, 404);
  });
});
