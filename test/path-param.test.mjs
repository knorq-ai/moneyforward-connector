import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathParam } from '../dist/api/path.js';

test('pathParam rejects the route-traversal id from the security review', () => {
  // `123/disapprove#` on the approve endpoint produces
  // /.../approving_ex_reports/123/disapprove#/approve — the fragment is never
  // sent, so an approve call would execute a disapproval.
  assert.throws(() => pathParam('123/disapprove#', 'report_id'), /report_id の形式が不正/);
});

test('pathParam rejects every shape that can change the target route', () => {
  for (const bad of [
    '123/disapprove',
    '../../offices',
    '.',
    '..',
    '1?x=2',
    '1#frag',
    '1 2',
    'a/b',
    '%2e%2e',
    'id\n',
    '',
  ]) {
    assert.throws(() => pathParam(bad, 'id'), Error, `expected rejection for ${JSON.stringify(bad)}`);
  }
});

test('pathParam rejects absurdly long ids', () => {
  assert.throws(() => pathParam('a'.repeat(129)), /長すぎます/);
});

test('pathParam accepts the id shapes MoneyForward actually returns', () => {
  assert.equal(pathParam('123'), '123');
  assert.equal(pathParam('9fa1c0de-1234-4abc-8def-0123456789ab'), '9fa1c0de-1234-4abc-8def-0123456789ab');
  assert.equal(pathParam('AbC_123-xyz'), 'AbC_123-xyz');
});
