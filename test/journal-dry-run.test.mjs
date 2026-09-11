import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome, cleanupTempHomes, assertIsolated } from './helpers/home.mjs';

// Adapted from the proposed patch: HOME goes through the shared helper.
useTempHome('mf-journal-dry-run-');
assertIsolated();
const savedEnv = {
  MF_ACCOUNTING_CLIENT_ID: process.env.MF_ACCOUNTING_CLIENT_ID,
  MF_ACCOUNTING_CLIENT_SECRET: process.env.MF_ACCOUNTING_CLIENT_SECRET,
};
process.env.MF_ACCOUNTING_CLIENT_ID = 'test-client';
process.env.MF_ACCOUNTING_CLIENT_SECRET = 'test-secret';

const { accountingJournalTools } = await import('../dist/tools/accounting/journals.js');
const { ApiClient } = await import('../dist/api/client.js');

after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  cleanupTempHomes();
});

const tool = accountingJournalTools.mf_accounting_update_journal;
const args = {
  journal_id: 'journal-1',
  transaction_date: '2026-09-01',
  branches: [{
    debitor: { account_id: 'debit-1', value: 100 },
    creditor: { account_id: 'credit-1', value: 100 },
  }],
};

test('dry-run never reads or writes the API, including when journal_type is omitted', async (t) => {
  const calls = [];
  for (const method of ['get', 'put']) {
    t.mock.method(ApiClient.prototype, method, async () => {
      calls.push(method);
      throw new Error('unexpected API call');
    });
  }

  const missing = await tool.handler(tool.inputSchema.parse({ ...args, dry_run: true }));
  assert.deepEqual(calls, []);
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /journal_type を明示/);

  const explicit = await tool.handler(tool.inputSchema.parse({
    ...args, journal_type: 'adjusting_entry', dry_run: true,
  }));
  assert.deepEqual(calls, []);
  assert.equal(explicit.isError, undefined);
  const body = JSON.parse(explicit.content[0].text.split('\n\n')[1]);
  assert.equal(body.journal.journal_type, 'adjusting_entry');
});

test('dry-run validation works with credentials absent', async () => {
  delete process.env.MF_ACCOUNTING_CLIENT_ID;
  delete process.env.MF_ACCOUNTING_CLIENT_SECRET;
  try {
    const result = await tool.handler(tool.inputSchema.parse({ ...args, dry_run: true }));
    assert.match(result.content[0].text, /journal_type を明示/);
    assert.doesNotMatch(result.content[0].text, /CLIENT_ID|authenticated/i);
  } finally {
    process.env.MF_ACCOUNTING_CLIENT_ID = 'test-client';
    process.env.MF_ACCOUNTING_CLIENT_SECRET = 'test-secret';
  }
});

test('real updates preserve a stored adjusting_entry when the type is omitted', async (t) => {
  const calls = [];
  t.mock.method(ApiClient.prototype, 'get', async (endpoint) => {
    calls.push(['GET', endpoint]);
    return { journal: { journal_type: 'adjusting_entry' } };
  });
  t.mock.method(ApiClient.prototype, 'put', async (endpoint, body) => {
    calls.push(['PUT', endpoint, body]);
    return { journal: { id: 'journal-1', number: '1', tags: [], ...body.journal } };
  });

  const result = await tool.handler(tool.inputSchema.parse({ ...args, dry_run: false }));
  assert.equal(result.isError, undefined);
  assert.deepEqual(calls.map(([method]) => method), ['GET', 'PUT']);
  assert.equal(calls[1][2].journal.journal_type, 'adjusting_entry');
});
