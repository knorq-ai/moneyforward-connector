import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const testScript = pkg.scripts.test;

test('the test script does not rely on Node expanding a glob', () => {
  // Node 20's runner stats each argument as a literal pathname; it does not
  // expand globs. A quoted 'test/**/*.test.mjs' therefore matched nothing and
  // the suite silently ran zero files on the version package.json advertises.
  assert.doesNotMatch(
    testScript,
    /['"][^'"]*\*[^'"]*['"]/,
    `quoted glob in the test script would not expand on Node 20: ${testScript}`,
  );
});

test('the test script does not use flags newer than the declared engine', () => {
  // --test-timeout landed in Node 20.11, but engines allows >=20.0.0.
  assert.doesNotMatch(testScript, /--test-timeout/, testScript);
  assert.equal(pkg.engines.node, '>=20.0.0');
});

test('the test script covers every test file on disk', () => {
  const onDisk = fs
    .readdirSync(path.join(root, 'test'))
    .filter((f) => f.endsWith('.test.mjs'))
    .sort();
  assert.ok(onDisk.length > 0);

  // The pattern is expanded by the shell (sh/bash/zsh all handle test/*.test.mjs).
  // Anything nested deeper would be missed, so keep the suite flat or widen this.
  const nested = [];
  for (const entry of fs.readdirSync(path.join(root, 'test'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const inner of fs.readdirSync(path.join(root, 'test', entry.name))) {
      if (inner.endsWith('.test.mjs')) nested.push(`${entry.name}/${inner}`);
    }
  }
  assert.deepEqual(
    nested,
    [],
    `these files sit below test/ and would not be run by "${testScript}": ${nested}`,
  );
});
