import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome, cleanupTempHomes, assertIsolated } from './helpers/home.mjs';

// Adapted from the proposed patch: HOME goes through the shared helper.
useTempHome('mf-billing-items-');
assertIsolated();
const savedEnv = {
  MF_INVOICE_CLIENT_ID: process.env.MF_INVOICE_CLIENT_ID,
  MF_INVOICE_CLIENT_SECRET: process.env.MF_INVOICE_CLIENT_SECRET,
};
process.env.MF_INVOICE_CLIENT_ID = 'test-client';
process.env.MF_INVOICE_CLIENT_SECRET = 'test-secret';

const { validateReplacementItems, replaceBillingItems } = await import('../dist/api/invoice/billings.js');
const { billingTools } = await import('../dist/tools/invoice/billings.js');
const { ApiClient } = await import('../dist/api/client.js');

after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  cleanupTempHomes();
});

const valid = [{ name: 'Service', price: 100, quantity: 1, excise: 'ten_percent' }];

test('validateReplacementItems rejects an item with neither item_id nor excise', () => {
  assert.throws(
    () => validateReplacementItems([{ name: 'Service', price: 100, quantity: 1 }]),
    /excise（消費税区分）が必須/,
  );
});

test('validateReplacementItems rejects a missing name when no item_id is given', () => {
  assert.throws(
    () => validateReplacementItems([{ price: 100, quantity: 1, excise: 'ten_percent' }]),
    /name が必須/,
  );
});

test('validateReplacementItems rejects an empty replacement', () => {
  assert.throws(() => validateReplacementItems([]), /1 件以上の明細が必要/);
});

test('validateReplacementItems rejects non-numeric amounts', () => {
  assert.throws(
    () => validateReplacementItems([{ name: 'x', price: 'free', quantity: 1, excise: 'ten_percent' }]),
    /price は数値/,
  );
});

test('validateReplacementItems accepts item_id-only and fully specified items', () => {
  validateReplacementItems([{ item_id: 'abc123', price: 100, quantity: 1 }]);
  validateReplacementItems(valid);
});

test('an invalid replacement deletes nothing — it never reaches the API', async () => {
  // The validation error must occur before any authenticated API operation.
  await assert.rejects(
    () => replaceBillingItems('billing-1', [{ name: 'Service', price: 100, quantity: 1 }]),
    (err) => {
      assert.match(err.message, /既存明細の削除を行いませんでした/);
      assert.doesNotMatch(err.message, /CLIENT_ID|authenticated/i);
      return true;
    },
  );
});

const reference = { item_id: 'item-1', price: 100, quantity: 1 };
const invalidItems = [
  ['item_id plus excise', { ...reference, excise: 'ten_percent' }],
  ['item_id plus name', { ...reference, name: 'Manual' }],
  ['blank item_id', { ...reference, item_id: ' ' }],
  ['blank item_id with manual fields', { ...valid[0], item_id: ' ' }],
  ['blank name', { ...valid[0], name: ' \t ' }],
  ['non-string name', { ...valid[0], name: 42 }],
  ['non-string item_id', { ...reference, item_id: 42 }],
  ['path-like item_id', { ...reference, item_id: '../item' }],
  ['overlong item_id', { ...reference, item_id: 'a'.repeat(129) }],
  ['invalid excise', { ...valid[0], excise: 'bogus' }],
  ['infinite price', { ...valid[0], price: Infinity }],
  ['NaN quantity', { ...valid[0], quantity: NaN }],
  ['invalid detail', { ...reference, detail: {} }],
  ['invalid withholding flag', { ...reference, is_deduct_withholding_tax: 'false' }],
];

for (const [label, item] of invalidItems) {
  test(`schema and replacement validator reject a later ${label}`, () => {
    const items = [valid[0], item];
    const parsed = billingTools.mf_update_billing.inputSchema.safeParse({
      billing_id: 'billing-1',
      items,
    });
    assert.equal(parsed.success, false, label);
    assert.throws(() => validateReplacementItems(items), /既存明細の削除を行いませんでした/);
  });

  test(`a later ${label} prevents every API operation, including DELETE`, async (t) => {
    const calls = [];
    t.mock.method(ApiClient.prototype, 'get', async () => {
      calls.push('GET');
      return { data: [{ id: 'existing-item' }] };
    });
    for (const method of ['delete', 'post']) {
      t.mock.method(ApiClient.prototype, method, async () => {
        calls.push(method.toUpperCase());
        return {};
      });
    }
    let error;
    try {
      await replaceBillingItems('billing-1', [valid[0], item]);
    } catch (caught) {
      error = caught;
    }
    assert.deepEqual(calls, [], 'all items must be validated before the first DELETE');
    assert.match(error?.message ?? '', /2件目/);
  });
}

test('sparse arrays cannot skip validation before deletion', () => {
  const items = [valid[0]];
  items.length = 2;
  assert.throws(() => validateReplacementItems(items), /2件目.*オブジェクトではありません/);
});
