import { getAccountingClient } from '../client.js';
import type { TaxResponse, ListTaxesParams } from '../../types/accounting.js';

export async function listTaxes(params?: ListTaxesParams): Promise<TaxResponse> {
  return getAccountingClient().get<TaxResponse>('/api/v3/taxes', {
    available: params?.available === undefined ? undefined : String(params.available),
  });
}
