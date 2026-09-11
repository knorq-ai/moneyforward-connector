import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome, cleanupTempHomes, REAL_HOME } from './helpers/home.mjs';

const home = useTempHome('mf-isolation-');
const { getConfigDir, getLegacyTokensFile, getServiceConfig } = await import('../dist/config.js');

after(cleanupTempHomes);

test('HOME isolation actually redirects every credential path', () => {
  assert.notEqual(os.homedir(), REAL_HOME);
  for (const p of [
    getConfigDir(),
    getLegacyTokensFile(),
    getServiceConfig('invoice').storage.tokensFile,
    getServiceConfig('expense').storage.tokensFile,
    getServiceConfig('accounting').storage.tokensFile,
  ]) {
    assert.ok(p.startsWith(home), `${p} escapes the temp home ${home}`);
    assert.ok(!p.startsWith(path.join(REAL_HOME, '.config')), `${p} points at real storage`);
  }
});

test('credential paths follow a later HOME change, so import order cannot leak', () => {
  // The fix is that these are resolved per call. Were they module-scope
  // constants again, the values below would still point at the first home and
  // a test that imported production code too early would hit real storage.
  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-isolation-2-'));
  const previous = process.env.HOME;
  process.env.HOME = second;
  try {
    assert.ok(
      getConfigDir().startsWith(second),
      `getConfigDir() returned ${getConfigDir()} after HOME moved to ${second}`,
    );
    assert.ok(
      getLegacyTokensFile().startsWith(second),
      `getLegacyTokensFile() returned ${getLegacyTokensFile()} after HOME moved`,
    );
    assert.ok(getServiceConfig('invoice').storage.tokensFile.startsWith(second));
  } finally {
    process.env.HOME = previous;
    fs.rmSync(second, { recursive: true, force: true });
  }
});

test('no test file reaches for the real home outside the helper', () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const offenders = [];
  for (const entry of fs.readdirSync(testDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.test.mjs')) continue;
    const body = fs.readFileSync(path.join(testDir, entry.name), 'utf-8');
    // os.homedir() / $HOME belong in helpers/home.mjs only. Anywhere else they
    // mean a test is writing into the user's real configuration directory.
    for (const pattern of [/os\.homedir\(\)/, /homedir\(\)/, /process\.env\.HOME/]) {
      if (pattern.test(body)) offenders.push(`${entry.name}: ${pattern}`);
    }
  }
  assert.deepEqual(
    offenders.filter((o) => !o.startsWith('isolation.test.mjs')),
    [],
    `these tests resolve the home directory themselves instead of using helpers/home.mjs: ${offenders}`,
  );
});
