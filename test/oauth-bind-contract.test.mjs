import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { useTempHome, cleanupTempHomes, assertIsolated } from './helpers/home.mjs';

// Adapted from the proposed patch: HOME goes through the shared helper so the
// suite's isolation guard stays satisfied.
const home = useTempHome('mf-bind-');
assertIsolated();
const savedEnv = {
  MF_CALLBACK_PORT: process.env.MF_CALLBACK_PORT,
  MF_REDIRECT_URI: process.env.MF_REDIRECT_URI,
};
process.env.MF_CALLBACK_PORT = '38101';
const { OAuthManager, getCurrentlyAuthenticatingService } = await import('../dist/auth/oauth.js');

after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  cleanupTempHomes();
});

function managerFor(host) {
  process.env.MF_REDIRECT_URI = `http://${host}:38101/callback`;
  return new OAuthManager({
    name: 'bind-test',
    oauth: {
      clientId: 'test',
      clientSecret: 'test',
      authorizeUrl: 'https://example.invalid/authorize',
      tokenUrl: 'https://example.invalid/token',
      scopes: 'test',
    },
    api: { baseUrl: 'https://example.invalid' },
    storage: { tokensFile: path.join(home, 'tokens.json') },
  });
}

/** Replace http.createServer with fakes so bind failures are deterministic. */
function interceptServers(t, failedHost) {
  const servers = [];
  t.mock.method(http, 'createServer', () => {
    const server = new EventEmitter();
    server.closed = false;
    server.listen = (port, host) => {
      server.host = host;
      server.port = port;
      queueMicrotask(() => {
        if (host === failedHost) {
          server.emit('error', Object.assign(new Error('busy'), { code: 'EADDRINUSE' }));
        } else {
          server.emit('listening');
        }
      });
      return server;
    };
    server.address = () => (server.closed ? null : { address: server.host, port: server.port });
    server.closeAllConnections = () => { server.connectionsClosed = true; };
    server.close = () => { server.closed = true; return server; };
    servers.push(server);
    return server;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return servers;
}

for (const [host, expected] of [
  ['127.0.0.1', ['127.0.0.1']],
  ['[::1]', ['::1']],
  ['localhost', ['127.0.0.1', '::1']],
]) {
  test(`redirect ${host} requires exactly its listener set`, async (t) => {
    const servers = interceptServers(t);
    const manager = managerFor(host);
    const flow = await manager.startCallbackServerFlow();
    const settled = flow.tokenPromise.catch(() => {});
    try {
      assert.deepEqual(
        manager.getServerAddresses(),
        expected.map((address) => ({ address, port: 38101 })),
      );
    } finally {
      manager.stopServer();
      await settled;
    }
    assert.ok(servers.every((server) => server.closed && server.connectionsClosed));
    assert.equal(getCurrentlyAuthenticatingService(), null);
  });
}

for (const [host, failedHost] of [
  ['127.0.0.1', '127.0.0.1'],
  ['[::1]', '::1'],
  ['localhost', '127.0.0.1'],
  ['localhost', '::1'],
]) {
  test(`redirect ${host} fails if ${failedHost} cannot bind`, async (t) => {
    const servers = interceptServers(t, failedHost);
    const manager = managerFor(host);
    let settled;
    try {
      await assert.rejects(async () => {
        const flow = await manager.startCallbackServerFlow();
        settled = flow.tokenPromise.catch(() => {});
      }, (error) => {
        assert.ok(error.message.includes(failedHost), error.message);
        assert.match(error.message, /38101/);
        assert.match(error.message, /MF_CALLBACK_PORT.*MF_REDIRECT_URI/);
        return true;
      });
      assert.equal(manager.hasPendingFlow(), false);
      assert.equal(getCurrentlyAuthenticatingService(), null);
      assert.ok(servers.every((server) => server.closed));
    } finally {
      manager.stopServer();
      await settled;
    }
  });
}

test('the callback flow refuses to start in OOB mode', async () => {
  process.env.MF_REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';
  const manager = new OAuthManager({
    name: 'bind-test',
    oauth: {
      clientId: 'test', clientSecret: 'test',
      authorizeUrl: 'https://example.invalid/authorize',
      tokenUrl: 'https://example.invalid/token', scopes: 'test',
    },
    api: { baseUrl: 'https://example.invalid' },
    storage: { tokensFile: path.join(home, 'tokens.json') },
  });
  await assert.rejects(() => manager.startCallbackServerFlow(), /ループバック URL/);
});
