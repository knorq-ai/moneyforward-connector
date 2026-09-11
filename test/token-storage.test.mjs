import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { useTempHome, cleanupTempHomes, assertIsolated } from './helpers/home.mjs';

const home = useTempHome('mf-storage-');
assertIsolated();
const { OAuthManager } = await import('../dist/auth/oauth.js');
const { getServiceConfig, getLegacyTokensFile } = await import('../dist/config.js');

after(cleanupTempHomes);

const TOKENS = JSON.stringify({
  access_token: 'fixture-access',
  refresh_token: 'fixture-refresh',
  expires_in: 3600,
});

const mode = (p) => fs.statSync(p).mode & 0o777;

/** Create the token file and its directory deliberately world-readable. */
function seedPermissive(file) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.chmodSync(dir, 0o755);                       // explicitly permissive
  fs.writeFileSync(file, TOKENS);
  fs.chmodSync(file, 0o644);                      // explicitly permissive
  assert.equal(mode(dir), 0o755, 'fixture directory must start permissive');
  assert.equal(mode(file), 0o644, 'fixture file must start permissive');
}

test('a token file left 0644 by an older version is tightened on startup', () => {
  const file = getServiceConfig('accounting').storage.tokensFile;
  seedPermissive(file);

  new OAuthManager(getServiceConfig('accounting'));

  assert.equal(mode(file), 0o600, 'token file must be 0600 after construction');
  assert.equal(mode(path.dirname(file)), 0o700, 'token directory must be 0700 after construction');
});

test('the tokens are still readable after hardening', () => {
  const config = getServiceConfig('expense');
  seedPermissive(config.storage.tokensFile);
  const manager = new OAuthManager(config);
  assert.equal(manager.isAuthenticated(), true);
  assert.equal(mode(config.storage.tokensFile), 0o600);
});

test('legacy tokens migrate with 0600 and the legacy copy is tightened too', () => {
  const legacy = getLegacyTokensFile();
  const target = getServiceConfig('invoice').storage.tokensFile;
  fs.rmSync(target, { force: true });
  seedPermissive(legacy);

  new OAuthManager(getServiceConfig('invoice'));

  assert.ok(fs.existsSync(target), 'legacy tokens should have been migrated');
  assert.equal(mode(target), 0o600, 'migrated copy must not inherit 0644');
  assert.equal(mode(legacy), 0o600, 'legacy copy must be tightened, not left world-readable');
  assert.equal(fs.readFileSync(target, 'utf-8'), TOKENS);
});

test('migration never reads outside the isolated home', () => {
  // Guards the isolation itself: if HOME were not redirected, this path would
  // be the user's real credential file.
  assert.ok(getLegacyTokensFile().startsWith(home));
  assert.ok(getServiceConfig('invoice').storage.tokensFile.startsWith(home));
});
