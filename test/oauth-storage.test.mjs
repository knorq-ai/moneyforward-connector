import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { useTempHome, cleanupTempHomes, assertIsolated } from './helpers/home.mjs';

// Adapted from the proposed patch: HOME goes through the shared helper, and the
// legacy path comes from getLegacyTokensFile() rather than a module constant.
const home = useTempHome('mf-token-storage-');
assertIsolated();
const savedEnv = {
  MF_CALLBACK_PORT: process.env.MF_CALLBACK_PORT,
  MF_REDIRECT_URI: process.env.MF_REDIRECT_URI,
};
process.env.MF_CALLBACK_PORT = '38102';
process.env.MF_REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

const { OAuthManager } = await import('../dist/auth/oauth.js');
const { getLegacyTokensFile } = await import('../dist/config.js');

after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  cleanupTempHomes();
});

let sequence = 0;
const tokens = { access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 };

function config() {
  return {
    name: 'invoice',
    oauth: {
      clientId: 'test', clientSecret: 'test',
      authorizeUrl: 'https://example.invalid/authorize',
      tokenUrl: 'https://example.invalid/token', scopes: 'test',
    },
    api: { baseUrl: 'https://example.invalid' },
    storage: { tokensFile: path.join(home, `case-${sequence++}`, 'tokens.json') },
  };
}

/** Seed a token file and its directory deliberately world-readable. */
function existing(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(tokens), { mode: 0o600 });
  fs.chmodSync(file, 0o644);
  fs.chmodSync(path.dirname(file), 0o755);
}

function syncMocks(t) {
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
}

function tokenResponse(t) {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(tokens), { status: 200 }));
}

test('new saves and rewrites harden the descriptor before writing token bytes', async (t) => {
  const conf = config();
  const manager = new OAuthManager(conf);
  tokenResponse(t);
  t.mock.method(console, 'error', () => {});
  const write = fs.writeFileSync;
  const chmod = fs.fchmodSync;
  const secured = new Map();
  let writes = 0;
  t.mock.method(fs, 'fchmodSync', (fd, mode) => {
    chmod(fd, mode);
    secured.set(fd, mode);
  });
  t.mock.method(fs, 'writeFileSync', (fd, data, ...options) => {
    assert.equal(typeof fd, 'number', 'token writes must use a descriptor');
    assert.equal(secured.get(fd), 0o600, 'fchmod must precede token bytes');
    assert.equal(fs.fstatSync(fd).mode & 0o7777, 0o600);
    writes++;
    return write(fd, data, ...options);
  });
  syncMocks(t);

  await manager.exchangeCode('test-code');
  fs.chmodSync(conf.storage.tokensFile, 0o644);
  fs.chmodSync(path.dirname(conf.storage.tokensFile), 0o755);
  await manager.exchangeCode('test-code');

  assert.equal(writes, 2);
  assert.equal(fs.statSync(conf.storage.tokensFile).mode & 0o7777, 0o600);
  assert.equal(fs.statSync(path.dirname(conf.storage.tokensFile)).mode & 0o7777, 0o700);
});

test('existing permissive storage is repaired and warned about before loading', (t) => {
  const conf = config();
  existing(conf.storage.tokensFile);
  const warnings = [];
  t.mock.method(console, 'error', (...args) => warnings.push(args.join(' ')));
  t.mock.method(console, 'log', () => assert.fail('warnings must not use stdout'));

  const manager = new OAuthManager(conf);

  assert.equal(manager.isAuthenticated(), true);
  assert.equal(fs.statSync(conf.storage.tokensFile).mode & 0o7777, 0o600);
  assert.equal(fs.statSync(path.dirname(conf.storage.tokensFile)).mode & 0o7777, 0o700);
  assert.equal(warnings.length, 2);
  assert.match(warnings.join('\n'), /755.*700/);
  assert.match(warnings.join('\n'), /644.*600/);
  // A warning must never echo the credentials it is protecting.
  assert.doesNotMatch(warnings.join('\n'), /test-access|test-refresh/);
});

test('hardening failure prevents existing tokens from being loaded', (t) => {
  const conf = config();
  existing(conf.storage.tokensFile);
  const failure = new Error('test fchmod failure');
  t.mock.method(fs, 'fchmodSync', () => { throw failure; });
  syncMocks(t);
  assert.throws(() => new OAuthManager(conf), (error) => error === failure);
});

test('hardening failure during saving is not swallowed or reported as authenticated', async (t) => {
  const manager = new OAuthManager(config());
  tokenResponse(t);
  const chmod = fs.fchmodSync;
  const failure = new Error('test token fchmod failure');
  t.mock.method(fs, 'fchmodSync', (fd, mode) => {
    if (mode === 0o600) throw failure;
    chmod(fd, mode);
  });
  syncMocks(t);

  await assert.rejects(() => manager.exchangeCode('test-code'), (error) => error === failure);
  assert.equal(manager.isAuthenticated(), false);
});

test('legacy migration also writes through a hardened descriptor and propagates failure', (t) => {
  const legacy = getLegacyTokensFile();
  existing(legacy);
  t.after(() => fs.rmSync(path.dirname(legacy), { recursive: true, force: true }));
  t.mock.method(console, 'error', () => {});
  const write = fs.writeFileSync;
  const failure = new Error('test migration write failure');
  let fail = false;
  let writes = 0;
  t.mock.method(fs, 'writeFileSync', (fd, data, ...options) => {
    assert.equal(typeof fd, 'number');
    assert.equal(fs.fstatSync(fd).mode & 0o7777, 0o600);
    writes++;
    if (fail) throw failure;
    return write(fd, data, ...options);
  });
  syncMocks(t);

  const migrated = config();
  assert.equal(new OAuthManager(migrated).isAuthenticated(), true);
  assert.equal(writes, 1);
  assert.equal(fs.statSync(legacy).mode & 0o7777, 0o600);

  fail = true;
  assert.throws(() => new OAuthManager(config()), (error) => error === failure);
});
