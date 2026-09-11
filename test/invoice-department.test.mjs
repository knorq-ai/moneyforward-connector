import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome, cleanupTempHomes, assertIsolated } from './helpers/home.mjs';

// Adapted from the proposed patch: HOME goes through the shared helper.
useTempHome('mf-department-');
assertIsolated();
const savedEnv = {
  MF_INVOICE_CLIENT_ID: process.env.MF_INVOICE_CLIENT_ID,
  MF_INVOICE_CLIENT_SECRET: process.env.MF_INVOICE_CLIENT_SECRET,
};
process.env.MF_INVOICE_CLIENT_ID = 'test-client';
process.env.MF_INVOICE_CLIENT_SECRET = 'test-secret';

const { billingTools } = await import('../dist/tools/invoice/billings.js');
const { quoteTools } = await import('../dist/tools/invoice/quotes.js');
const { ApiClient } = await import('../dist/api/client.js');

after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  cleanupTempHomes();
});

for (const [label, tool, dates, endpoint] of [
  ['billing', billingTools.mf_create_billing, { billing_date: '2026-09-01' }, '/invoice_template_billings'],
  ['quote', quoteTools.mf_create_quote, { quote_date: '2026-09-01', expired_date: '2026-09-30' }, '/quotes'],
]) {
  for (const [scenario, departmentId, departments, selected] of [
    // The P1: an explicit department from a different partner must not be used.
    ['foreign explicit department', 'other', ['department-a'], undefined],
    ['explicit department with no memberships', 'other', [], undefined],
    ['explicit member among several', 'department-b', ['department-a', 'department-b'], 'department-b'],
    ['omitted with a single department', undefined, ['department-a'], 'department-a'],
    ['omitted with several departments', undefined, ['department-a', 'department-b'], undefined],
    ['omitted with no departments', undefined, [], undefined],
  ]) {
    test(`${label}: ${scenario}`, async (t) => {
      const calls = [];
      t.mock.method(ApiClient.prototype, 'get', async (url) => {
        calls.push(['GET', url]);
        return { data: departments.map((id) => ({ id, name: id })) };
      });
      t.mock.method(ApiClient.prototype, 'post', async (url, body) => {
        calls.push(['POST', url, body.department_id]);
        return { id: 'document-1', total_price: '100' };
      });

      const result = await tool.handler(tool.inputSchema.parse({
        partner_id: 'partner-a',
        ...(departmentId === undefined ? {} : { department_id: departmentId }),
        ...dates,
        items: [{ name: 'Service', price: 100, quantity: 1, excise: 'ten_percent' }],
      }));

      const expected = [['GET', '/partners/partner-a/departments']];
      if (selected !== undefined) expected.push(['POST', endpoint, selected]);
      assert.deepEqual(calls, expected);
      assert.equal(result.isError, selected === undefined ? true : undefined);
      if (departmentId !== undefined && selected === undefined) {
        assert.match(result.content[0].text, /この取引先の部署ではありません/);
      }
    });
  }
}
