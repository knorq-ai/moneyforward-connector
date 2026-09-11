import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome, cleanupTempHomes, assertIsolated } from './helpers/home.mjs';

useTempHome('mf-errflag-');
assertIsolated();
const { accountingJournalTools } = await import('../dist/tools/accounting/journals.js');
const { deliveryTools } = await import('../dist/tools/invoice/delivery.js');

after(cleanupTempHomes);

// Item 6 of the proposed patch set covered the two journal guards; this file is
// the superset — it also pins delivery.ts and asserts a dry run is NOT flagged,
// so the sweep cannot be satisfied by flagging everything.

/** Every failure result must carry isError, or MCP reports it as a success. */
function assertFailure(result, label) {
  assert.equal(result.isError, true, `${label} returned a failure without isError: ${JSON.stringify(result)}`);
  assert.ok(result.content?.[0]?.text, `${label} returned no message`);
}

test('list_journals without a date range is a failure, not a success', async () => {
  // Both fields are optional in the schema, so this guard is reachable from a
  // normal tool call: mf_accounting_list_journals({}).
  const result = await accountingJournalTools.mf_accounting_list_journals.handler({});
  assertFailure(result, 'mf_accounting_list_journals({})');
  assert.match(result.content[0].text, /start_date.*end_date/);
});

test('delete_journal without confirm is a failure, not a success', async () => {
  const result = await accountingJournalTools.mf_accounting_delete_journal.handler({
    journal_id: 'j1',
    confirm: false,
  });
  assertFailure(result, 'mf_accounting_delete_journal({confirm:false})');
  assert.match(result.content[0].text, /confirm=true/);
});

test('create_delivery_slip reports failure — the endpoint does not exist', async () => {
  // The tool is registered but cannot work. Returning success would let a
  // caller believe a delivery slip was created.
  const result = await deliveryTools.mf_create_delivery_slip.handler({ quote_id: 'q1' });
  assertFailure(result, 'mf_create_delivery_slip');
  assert.match(result.content[0].text, /未サポート/);
});

test('a caught API failure is flagged too', async () => {
  // No credentials in the temp home, so this fails inside the handler's catch.
  const result = await accountingJournalTools.mf_accounting_list_journals.handler({
    start_date: '2026-01-01',
  });
  assertFailure(result, 'mf_accounting_list_journals (unauthenticated)');
});

test('a dry-run create is NOT flagged as an error', async () => {
  // Guards against over-flagging: a successful offline preview must stay a
  // success even though it never reaches the API.
  const result = await accountingJournalTools.mf_accounting_create_journal.handler({
    transaction_date: '2026-01-01',
    journal_type: 'journal_entry',
    dry_run: true,
    branches: [
      {
        debitor: { value: 1100, account_id: 'a1' },
        creditor: { value: 1100, account_id: 'a2' },
      },
    ],
  });
  assert.notEqual(result.isError, true, `dry-run was flagged as an error: ${JSON.stringify(result)}`);
});
