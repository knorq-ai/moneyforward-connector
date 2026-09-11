import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCallbackPort, validateRedirectUri } from '../dist/auth/oauth.js';

test('resolveCallbackPort defaults and validates', () => {
  assert.equal(resolveCallbackPort(undefined), 38080);
  assert.equal(resolveCallbackPort(''), 38080);
  assert.equal(resolveCallbackPort('38080'), 38080);
  assert.equal(resolveCallbackPort(' 4000 '), 4000);
  // Port 0 would open an ephemeral listener the user never registered.
  assert.throws(() => resolveCallbackPort('0'), /範囲外/);
  assert.throws(() => resolveCallbackPort('65536'), /範囲外/);
  assert.throws(() => resolveCallbackPort('-1'), /数値ではありません/);
  assert.throws(() => resolveCallbackPort('http://x'), /数値ではありません/);
});

test('validateRedirectUri accepts only OOB and matching loopback URLs', () => {
  assert.equal(
    validateRedirectUri('urn:ietf:wg:oauth:2.0:oob', 38080),
    'urn:ietf:wg:oauth:2.0:oob',
  );
  assert.equal(
    validateRedirectUri('http://127.0.0.1:38080/callback', 38080),
    'http://127.0.0.1:38080/callback',
  );
  assert.equal(
    validateRedirectUri('http://localhost:38080/callback', 38080),
    'http://localhost:38080/callback',
  );
  // A port mismatch authenticates fine and then never calls back — catch it early.
  assert.throws(() => validateRedirectUri('http://127.0.0.1:9999/callback', 38080), /一致しません/);
  assert.throws(() => validateRedirectUri('http://example.com:38080/cb', 38080), /ホストは/);
  assert.throws(() => validateRedirectUri('https://127.0.0.1:38080/cb', 38080), /http:\/\//);
  assert.throws(() => validateRedirectUri('not a url', 38080), /URL として不正/);
});
