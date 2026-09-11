import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { useTempHome, cleanupTempHomes } from './helpers/home.mjs';

// Must run before importing the module: the denylist is derived from HOME.
const home = useTempHome('mf-receipt-');
const { resolveReceiptPath, uploadReceipt } = await import('../dist/api/expense/receipts.js');

const workDir = fs.mkdtempSync(path.join(home, 'work-'));
after(cleanupTempHomes);

function write(name, bytes = 'x') {
  const p = path.join(workDir, name);
  fs.writeFileSync(p, bytes);
  return p;
}

function inHome(...segments) {
  const p = path.join(home, ...segments);
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, '{"access_token":"fixture-not-a-real-token"}', { mode: 0o600 });
  return p;
}

test('a real image is accepted and resolved', () => {
  const p = write('receipt.png');
  assert.equal(resolveReceiptPath(p), fs.realpathSync(p));
});

test('every denied credential directory is refused', () => {
  for (const rel of [
    ['.config', 'mf-mcp', 'invoice-tokens.json'],
    ['.config', 'mf-invoice-mcp', 'tokens.json'],
    ['.config', 'anything-under-config.json'],
    ['.claude', 'settings.json'],
    ['.claude.json'],
    ['.ssh', 'id_ed25519'],
  ]) {
    const target = inHome(...rel);
    assert.throws(
      () => resolveReceiptPath(target),
      /アップロードできません/,
      `expected ${path.join(...rel)} to be refused`,
    );
  }
});

test('a symlink named like an image but pointing at the token cache is refused', () => {
  const target = inHome('.config', 'mf-mcp', 'invoice-tokens.json');
  const link = path.join(workDir, 'looks-like-a-receipt.png');
  fs.rmSync(link, { force: true });
  fs.symlinkSync(target, link);
  assert.throws(() => resolveReceiptPath(link), /アップロードできません/);
});

test('a non-receipt extension is refused before anything is transmitted', () => {
  assert.throws(() => resolveReceiptPath(write('secrets.json', '{}')), /拡張子ではありません/);
  assert.throws(() => resolveReceiptPath(write('notes.txt')), /拡張子ではありません/);
  assert.throws(() => resolveReceiptPath(write('noext')), /拡張子ではありません/);
});

test('the extension check runs before the size check', () => {
  // Pinned order: realpath -> denylist -> extension -> size. A 30MB .json must
  // report the extension, not the size, or the order has drifted.
  const big = path.join(workDir, 'huge.json');
  fs.writeFileSync(big, Buffer.alloc(21 * 1024 * 1024));
  assert.throws(() => resolveReceiptPath(big), /拡張子ではありません/);
  fs.rmSync(big);
});

test('an oversized image is refused', () => {
  const big = path.join(workDir, 'huge.png');
  fs.writeFileSync(big, Buffer.alloc(21 * 1024 * 1024));
  assert.throws(() => resolveReceiptPath(big), /大きすぎます/);
  fs.rmSync(big);
});

test('directories, empty files and missing paths are refused', () => {
  assert.throws(() => resolveReceiptPath(workDir), /通常のファイルではありません/);
  assert.throws(() => resolveReceiptPath(write('empty.png', '')), /ファイルが空/);
  assert.throws(() => resolveReceiptPath(path.join(workDir, 'nope.png')), /見つかりません/);
  assert.throws(() => resolveReceiptPath(''), /空です/);
});

test('uploadReceipt itself refuses a credential file — the guard is on the call site', async () => {
  // Pins the production call site, not just the helper. No credentials are
  // configured, so reaching the network would fail with an auth error instead.
  const target = inHome('.config', 'mf-mcp', 'invoice-tokens.json');
  await assert.rejects(
    () => uploadReceipt('office1', target),
    (err) => {
      assert.match(err.message, /アップロードできません/);
      assert.doesNotMatch(err.message, /CLIENT_ID|authenticated|環境変数/i);
      return true;
    },
  );
});

test('uploadReceipt refuses a bad extension before any request', async () => {
  await assert.rejects(
    () => uploadReceipt('office1', write('payload.json', '{}')),
    /拡張子ではありません/,
  );
});
